import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, distinctUntilChanged, fromEvent, map, merge, mergeMap, of, skip, switchMap, tap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { ServerStateService } from '../services/server-state.service'
import * as RouteActions from './route.actions'
import { OUTBOX_STORAGE_KEY, RouteState } from './route.reducer'
import type { BatchSegmentState, OutboxItem } from '../types'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly api = inject(RouteApiService)
  private readonly server = inject(ServerStateService)

  /** 服务端状态变更（本标签页写入后的回推、其他标签页 storage 同步）统一同步到 store */
  private readonly serverStateSync$ = createEffect(() => this.server.state$.pipe(
    skip(1),
    map((state) => RouteActions.serverStateChanged({ routes: state.routes, comments: state.comments, routeVersions: state.routeVersions, baselines: state.baselines })),
  ))

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      tap((routes) => this.server.seedIfEmpty(routes)),
      map(() => this.server.load()),
      map((state) => RouteActions.serverStateChanged({ routes: state.routes, comments: state.comments, routeVersions: state.routeVersions, baselines: state.baselines })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  changePermit$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.changePermit),
    withLatestFrom(this.store.select('routes')),
    switchMap(([action, state]) => {
      const result = this.server.changePermit({ routeId: action.routeId, permit: action.permit, permission: action.permission, baseVersion: state.routeVersions[action.routeId] ?? 6 })
      if (result.ok) return of()
      return of(RouteActions.mutationConflict({ conflict: result.conflict! }))
    }),
  ))

  changeSegmentRisk$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.changeSegmentRisk),
    withLatestFrom(this.store.select('routes')),
    switchMap(([action, state]) => {
      const result = this.server.changeSegmentRisk({ routeId: action.routeId, segmentId: action.segmentId, level: action.level, baseVersion: state.routeVersions[action.routeId] ?? 6 })
      if (result.ok) return of()
      return of(RouteActions.mutationConflict({ conflict: result.conflict! }))
    }),
  ))

  lockBaseline$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.lockBaseline),
    withLatestFrom(this.store.select('routes')),
    switchMap(([, state]) => {
      const routeId = state.selectedRouteId
      const result = this.server.lockBaseline({ routeId, baseVersion: state.routeVersions[routeId] ?? 6, lockedBy: '当前审阅人' })
      if (result.ok) return of()
      return of(RouteActions.mutationConflict({ conflict: result.conflict! }))
    }),
  ))

  /** 批次保存：服务端逐区段幂等处理；部分失败时从最后成功区段续传，已生成意见不重复 */
  saveReviewBatch$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.saveReviewBatch, RouteActions.resumeReviewBatch),
    withLatestFrom(this.store.select('routes')),
    switchMap(([, state]) => {
      const batch = state.currentBatch
      if (!batch || batch.status === 'completed') return of()
      const items = batch.segments
        .filter((segment: BatchSegmentState) => segment.affected && segment.opinion && segment.status !== 'succeeded')
        .map((segment: BatchSegmentState) => ({ segmentId: segment.segmentId, role: segment.opinion!.role, content: segment.opinion!.content, idempotencyKey: `${batch.id}:${segment.segmentId}` }))
      if (!items.length) return of()
      const result = this.server.saveBatch({ batchId: batch.id, routeId: batch.routeId, baseVersion: batch.baseVersion, items })
      if (result.conflict) return of(RouteActions.mutationConflict({ conflict: result.conflict }))
      if (result.ok) return of(RouteActions.reviewBatchCompleted({ results: result.results, version: result.version! }))
      return of(RouteActions.reviewBatchProgress({ results: result.results }))
    }),
  ))

  rebaseReviewBatch$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.rebaseReviewBatch),
    switchMap(() => {
      const state = this.server.load()
      return of(
        RouteActions.serverStateChanged({ routes: state.routes, comments: state.comments, routeVersions: state.routeVersions, baselines: state.baselines }),
        RouteActions.rebaseReviewBatchApply({ routeVersions: state.routeVersions }),
      )
    }),
  ))

  flushOutbox$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.flushOutbox),
    withLatestFrom(this.store.select('routes')),
    switchMap(([, state]) => {
      const pending = state.outbox.filter((item: OutboxItem) => item.status === 'pending')
      if (!pending.length) return of()
      const results = this.server.flushOutbox(pending)
      return results.map((result) => result.status === 'merged'
        ? RouteActions.outboxItemMerged({ id: result.id, commentId: result.commentId! })
        : RouteActions.outboxItemConflict({ id: result.id, reason: result.reason! }))
    }),
  ))

  onlineStatus$ = createEffect(() => merge(
    of(navigator.onLine),
    fromEvent(window, 'online').pipe(map((): boolean => true)),
    fromEvent(window, 'offline').pipe(map((): boolean => false)),
  ).pipe(
    distinctUntilChanged(),
    mergeMap((online) => {
      const isOnline = !!online
      return isOnline
        ? of(RouteActions.onlineStatusChanged({ online: isOnline }), RouteActions.flushOutbox())
        : of(RouteActions.onlineStatusChanged({ online: isOnline }))
    }),
  ))

  persistOutbox$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.queueOfflineOpinion, RouteActions.outboxItemMerged, RouteActions.outboxItemConflict, RouteActions.removeOutboxItem),
    withLatestFrom(this.store.select('routes')),
    tap(([, state]) => localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(state.outbox))),
  ), { dispatch: false })
}
