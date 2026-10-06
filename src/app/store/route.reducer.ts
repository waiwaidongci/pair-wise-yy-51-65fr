import { createReducer, on } from '@ngrx/store'
import type { ReviewBatch, ReviewComment, RouteBaseline, RoutePackage, SaveConflict } from '../types'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  batches: ReviewBatch[]
  baselines: RouteBaseline[]
  offlineQueue: ReviewComment[]
  conflict: SaveConflict | null
  loadedVersions: Record<string, number>
  loading: boolean
  error: string
  notice: string
  version: number
}

const INVALIDATABLE: ReviewComment['status'][] = ['待确认', '已接受']

/** 许可或区段风险变化时，相关区段的会签确认立即失效，等待复核批次重算 */
function invalidateComments(comments: ReviewComment[], segmentIds: ReadonlySet<string>): ReviewComment[] {
  return comments.map((comment) =>
    segmentIds.has(comment.segmentId) && INVALIDATABLE.includes(comment.status) ? { ...comment, status: '已失效' as const } : comment,
  )
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  loading: false,
  error: '',
  notice: '',
  version: 6,
  batches: [],
  baselines: [],
  offlineQueue: [],
  conflict: null,
  loadedVersions: {},
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes, versions }) => ({
    ...state,
    loading: false,
    routes,
    loadedVersions: versions,
    conflict: null,
    selectedRouteId: state.selectedRouteId || routes[0]?.id || '',
    selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '',
  })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => ({
    ...state,
    version: state.version + 1,
    notice: '',
    routes: state.routes.map((route) => ({ ...route, segments: route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment) })),
    comments: invalidateComments(state.comments, new Set([id])),
  })),
  on(RouteActions.updatePermission, (state, { routeId, permission }) => {
    const route = state.routes.find((item) => item.id === routeId)
    const segmentIds = new Set((route?.segments ?? []).map((segment) => segment.id))
    return {
      ...state,
      version: state.version + 1,
      notice: '',
      routes: state.routes.map((item) => item.id === routeId ? { ...item, permission } : item),
      comments: invalidateComments(state.comments, segmentIds),
    }
  }),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route),
  })),

  // 运输单保存：版本冲突只提示后保存的一方，先到先得的基线不被覆盖
  on(RouteActions.saveRouteSuccess, (state, { routeId, version }) => ({
    ...state,
    loadedVersions: { ...state.loadedVersions, [routeId]: version },
    conflict: null,
    notice: `运输单 ${routeId} 已保存，服务端版本 v${version}`,
  })),
  on(RouteActions.saveRouteFailure, (state, { error }) => ({ ...state, error })),
  on(RouteActions.saveRouteConflict, (state, { conflict }) => ({ ...state, conflict })),
  on(RouteActions.dismissConflict, (state) => ({ ...state, conflict: null })),

  // 复核批次：只处理队列中受影响的区段，游标即断点
  on(RouteActions.startReReview, (state, { batch }) => ({ ...state, batches: [...state.batches, batch] })),
  on(RouteActions.segmentReviewSuccess, (state, { batchId, segmentId, comment }) => ({
    ...state,
    comments: state.comments.some((item) => item.id === comment.id) ? state.comments : [comment, ...state.comments],
    batches: state.batches.map((batch) => {
      if (batch.id !== batchId || batch.queue[batch.cursor] !== segmentId) return batch
      const cursor = batch.cursor + 1
      return { ...batch, cursor, status: cursor >= batch.queue.length ? '已完成' as const : batch.status, error: '' }
    }),
  })),
  on(RouteActions.segmentReviewFailure, (state, { batchId, segmentId, error }) => ({
    ...state,
    batches: state.batches.map((batch) => batch.id === batchId && batch.queue[batch.cursor] === segmentId ? { ...batch, status: '已暂停' as const, error } : batch),
  })),
  on(RouteActions.resumeBatch, (state, { batchId }) => ({
    ...state,
    batches: state.batches.map((batch) => batch.id === batchId && batch.status === '已暂停' ? { ...batch, status: '进行中' as const, error: '' } : batch),
  })),

  // 离线意见：先入队，网络恢复后按 ID 合并，不触碰已锁定基线
  on(RouteActions.queueOfflineComment, (state, { comment }) => ({
    ...state,
    offlineQueue: state.offlineQueue.some((item) => item.id === comment.id) ? state.offlineQueue : [...state.offlineQueue, comment],
  })),
  on(RouteActions.offlineCommentSynced, (state, { comment }) => ({
    ...state,
    offlineQueue: state.offlineQueue.filter((item) => item.id !== comment.id),
    comments: state.comments.some((item) => item.id === comment.id) ? state.comments : [{ ...comment, offline: false }, ...state.comments],
  })),

  on(RouteActions.lockBaseline, (state, { routeId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const segments = Object.fromEntries(route.segments.map((segment) => [segment.id, { level: segment.level, status: segment.status, risks: segment.risks }]))
    const baseline = { routeId, version: state.version, locked: true, lockedAt: new Date().toLocaleString('zh-CN', { hour12: false }), segments }
    return {
      ...state,
      baselines: [...state.baselines.filter((item) => item.routeId !== routeId), baseline],
      notice: `运输单 ${routeId} 基线 v${state.version} 已锁定，审批意见与区段结论只读保存`,
    }
  }),
  on(RouteActions.sessionRestored, (state, session) => ({
    ...state,
    // 中断的批次恢复为可续跑状态，游标停留在最后一个成功区段之后
    batches: session.batches.map((batch) => batch.status === '进行中' ? { ...batch, status: '已暂停' as const, error: '会话已恢复，可从断点继续' } : batch),
    baselines: session.baselines,
    offlineQueue: session.offlineQueue,
  })),
)
