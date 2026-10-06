import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { EMPTY, fromEvent, of, Observable } from 'rxjs'
import { catchError, concatMap, map, mergeMap, tap, withLatestFrom } from 'rxjs/operators'
import { RouteApiService, RouteConflictError } from '../services/route-api.service'
import type { ReviewComment, RiskSegment } from '../types'
import * as RouteActions from './route.actions'
import type { RouteState } from './route.reducer'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly state$: Observable<RouteState> = this.store.select((state) => state.routes)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    concatMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes, versions: this.api.getServerVersions(routes.map((route) => route.id)) })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 许可或区段风险变化 → 只为受影响区段开启复核批次，其余区段沿用原结论 */
  invalidate$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.updateSegmentLevel, RouteActions.updatePermission),
    withLatestFrom(this.state$),
    concatMap(([action, state]) => {
      const routeId = action.type === RouteActions.updatePermission.type
        ? action.routeId
        : state.routes.find((route) => route.segments.some((segment) => segment.id === action.id))?.id
      const route = state.routes.find((item) => item.id === routeId)
      if (!route || !routeId) return EMPTY
      const affected = action.type === RouteActions.updatePermission.type
        ? route.segments.map((segment) => segment.id)
        : [action.id]
      // 已被未完结批次覆盖的区段不重复排队
      const queued = new Set(state.batches.filter((batch) => batch.routeId === routeId && batch.status !== '已完成').flatMap((batch) => batch.queue))
      const segmentIds = affected.filter((id) => !queued.has(id))
      if (!segmentIds.length) return EMPTY
      const reason = action.type === RouteActions.updatePermission.type ? `许可状态变更为「${action.permission}」` : '区段风险等级调整'
      return of(RouteActions.startReReview({
        batch: { id: `RB-${routeId}-${state.version}`, routeId, reason, queue: segmentIds, cursor: 0, status: '进行中', error: '' },
      }))
    }),
  ))

  /** 批次逐区段顺序执行；成功后由成功动作推进游标并触发下一段，失败即停在断点 */
  processBatch$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.startReReview, RouteActions.resumeBatch, RouteActions.segmentReviewSuccess),
    withLatestFrom(this.state$),
    concatMap(([action, state]) => {
      const batchId = action.type === RouteActions.startReReview.type ? action.batch.id : action.batchId
      const batch = state.batches.find((item) => item.id === batchId)
      if (!batch || batch.status !== '进行中' || batch.cursor >= batch.queue.length) return EMPTY
      const segmentId = batch.queue[batch.cursor]
      // 幂等：该区段的补充意见已生成（重试/刷新恢复）则直接跳过，不重复产生
      const existing = state.comments.find((comment) => comment.batchId === batch.id && comment.segmentId === segmentId)
      if (existing) return of(RouteActions.segmentReviewSuccess({ batchId: batch.id, routeId: batch.routeId, segmentId, comment: existing }))
      const segment = state.routes.find((route) => route.id === batch.routeId)?.segments.find((item) => item.id === segmentId)
      const comment = buildSupplementaryComment(batch.id, batch.routeId, batch.reason, segmentId, segment)
      return this.api.saveSegmentReview(batch.routeId, comment).pipe(
        map((saved) => RouteActions.segmentReviewSuccess({ batchId: batch.id, routeId: batch.routeId, segmentId, comment: saved })),
        catchError((error: unknown) => of(RouteActions.segmentReviewFailure({
          batchId: batch.id, routeId: batch.routeId, segmentId,
          error: error instanceof Error ? error.message : '区段复核保存失败',
        }))),
      )
    }),
  ))

  /** 保存运输单：乐观并发控制，服务端版本不一致时仅后保存的一方收到冲突 */
  saveRoute$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.saveRoute),
    withLatestFrom(this.state$),
    concatMap(([{ routeId }, state]) => {
      const expected = state.loadedVersions[routeId] ?? 0
      return this.api.commitRoute(routeId, expected).pipe(
        map(({ version }) => RouteActions.saveRouteSuccess({ routeId, version })),
        catchError((error: unknown) => of(error instanceof RouteConflictError
          ? RouteActions.saveRouteConflict({ conflict: { routeId, localVersion: expected, serverVersion: error.serverVersion } })
          : RouteActions.saveRouteFailure({ routeId, error: error instanceof Error ? error.message : '运输单保存失败' }))),
      )
    }),
  ))

  /** 在线发表的意见先落库；保存失败（如中途断网）自动转入离线队列 */
  saveComment$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.addComment),
    concatMap(({ comment }) => this.api.saveSegmentReview(comment.routeId ?? 'draft', comment).pipe(
      map(() => RouteActions.commentSaved({ id: comment.id })),
      catchError(() => of(RouteActions.queueOfflineComment({ comment: { ...comment, offline: true } }))),
    )),
  ))

  /** 网络恢复：合并离线意见（追加式，不覆盖已锁定基线），并自动续跑暂停的批次 */
  online$ = createEffect(() => fromEvent(window, 'online').pipe(
    withLatestFrom(this.state$),
    mergeMap(([, state]) => [
      ...(state.offlineQueue.length ? [RouteActions.syncOfflineComments()] : []),
      ...state.batches.filter((batch) => batch.status === '已暂停').map((batch) => RouteActions.resumeBatch({ batchId: batch.id })),
    ]),
  ))

  syncOffline$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.syncOfflineComments),
    withLatestFrom(this.state$),
    concatMap(([, state]) => state.offlineQueue),
    concatMap((comment) => this.api.saveSegmentReview(comment.routeId ?? 'draft', comment).pipe(
      map(() => RouteActions.offlineCommentSynced({ comment })),
      catchError(() => EMPTY), // 同步中途再次断网：保留在队列中，等待下一次 online
    )),
  ))

  restoreSession$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.restoreSession),
    map(() => RouteActions.sessionRestored(this.api.loadSession())),
  ))

  /** 批次游标、基线与离线队列持久化，刷新/重开后可从断点恢复 */
  persistSession$ = createEffect(() => this.actions$.pipe(
    ofType(
      RouteActions.startReReview, RouteActions.segmentReviewSuccess, RouteActions.segmentReviewFailure,
      RouteActions.resumeBatch, RouteActions.lockBaseline,
      RouteActions.queueOfflineComment, RouteActions.offlineCommentSynced,
    ),
    withLatestFrom(this.state$),
    tap(([, state]) => this.api.saveSession({ batches: state.batches, baselines: state.baselines, offlineQueue: state.offlineQueue })),
  ), { dispatch: false })
}

/** 补充意见使用确定性 ID（批次 + 区段），断点重跑与刷新恢复都不会产生重复 */
function buildSupplementaryComment(batchId: string, routeId: string, reason: string, segmentId: string, segment?: RiskSegment): ReviewComment {
  return {
    id: `SUP-${batchId}-${segmentId}`,
    segmentId,
    routeId,
    batchId,
    role: '系统',
    author: '复核引擎',
    content: `补充意见（${reason}）：区段 ${segmentId} 原会签结论已失效，按最新风险等级「${segment?.level ?? '未知'}」重新核定限速与监护条件；其余区段沿用原结论。`,
    status: '待确认',
  }
}
