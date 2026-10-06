import { createReducer, on } from '@ngrx/store'
import type { Baseline, BatchItemResult, BatchSegmentState, ConflictInfo, OutboxItem, ReviewBatch, ReviewComment, RoutePackage } from '../types'
import * as RouteActions from './route.actions'

export const OUTBOX_STORAGE_KEY = 'raildata-outbox-v1'

function loadOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as OutboxItem[]
  } catch { /* 落盘数据损坏时按空队列处理 */ }
  return []
}

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  routeVersions: Record<string, number>
  baselines: Record<string, Baseline>
  currentBatch: ReviewBatch | null
  conflict: ConflictInfo | null
  outbox: OutboxItem[]
  online: boolean
  saving: boolean
  loading: boolean
  error: string
  version: number
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', kind: '原结论' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', kind: '原结论' },
  ],
  routeVersions: {},
  baselines: {},
  currentBatch: null,
  conflict: null,
  outbox: loadOutbox(),
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  saving: false,
  loading: false,
  error: '',
  version: 6,
}

/** 受影响区段：存在已失效会签意见的区段（许可或风险变更导致） */
function affectedSegmentIds(route: RoutePackage | undefined, comments: ReviewComment[]): Set<string> {
  if (!route) return new Set<string>()
  const invalid = new Set(comments.filter((comment) => comment.status === '已失效').map((comment) => comment.segmentId))
  return new Set(route.segments.filter((segment) => invalid.has(segment.id)).map((segment) => segment.id))
}

function applyBatchResults(batch: ReviewBatch, results: BatchItemResult[]): ReviewBatch {
  const resultMap = new Map(results.map((result) => [result.segmentId, result]))
  return {
    ...batch,
    segments: batch.segments.map((segment) => {
      const result = resultMap.get(segment.segmentId)
      if (!result) return segment
      if (result.status === 'succeeded') {
        return { ...segment, status: 'succeeded' as const, generatedCommentId: result.commentId, error: undefined }
      }
      return { ...segment, status: 'failed' as const, error: result.error === 'NETWORK' ? '网络错误，保存中断' : '保存失败' }
    }),
  }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.serverStateChanged, (state, { routes, comments, routeVersions, baselines }) => ({
    ...state,
    loading: false,
    routes,
    comments,
    routeVersions,
    baselines,
    version: state.version + 1,
    selectedRouteId: state.selectedRouteId || routes[0]?.id || '',
    selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '',
  })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.mutationConflict, (state, { conflict }) => ({ ...state, conflict, saving: false })),
  on(RouteActions.clearConflict, (state) => ({ ...state, conflict: null })),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),

  on(RouteActions.startReviewBatch, (state) => {
    const route = state.routes.find((item) => item.id === state.selectedRouteId)
    if (!route) return state
    const affected = affectedSegmentIds(route, state.comments)
    const batch: ReviewBatch = {
      id: `B-${Date.now().toString(36).toUpperCase()}`,
      routeId: route.id,
      baseVersion: state.routeVersions[route.id] ?? 6,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      segments: route.segments.map((segment) => ({
        segmentId: segment.id,
        affected: affected.has(segment.id),
        status: affected.has(segment.id) ? 'pending' as const : 'skipped' as const,
        opinion: null,
      })),
    }
    return { ...state, currentBatch: batch, conflict: null, saving: false }
  }),
  on(RouteActions.updateBatchOpinion, (state, { segmentId, field, value }) => {
    if (!state.currentBatch) return state
    return {
      ...state,
      currentBatch: {
        ...state.currentBatch,
        segments: state.currentBatch.segments.map((segment) =>
          segment.segmentId === segmentId
            ? { ...segment, opinion: { role: segment.opinion?.role ?? '安全', content: segment.opinion?.content ?? '', [field]: value } }
            : segment,
        ),
      },
    }
  }),
  on(RouteActions.saveReviewBatch, (state) => ({ ...state, saving: true })),
  on(RouteActions.resumeReviewBatch, (state) => ({ ...state, saving: true, conflict: null })),
  on(RouteActions.reviewBatchProgress, (state, { results }) => {
    if (!state.currentBatch) return state
    return { ...state, currentBatch: { ...applyBatchResults(state.currentBatch, results), status: 'failed' as const }, saving: false }
  }),
  on(RouteActions.reviewBatchCompleted, (state, { results }) => {
    if (!state.currentBatch) return state
    return { ...state, currentBatch: { ...applyBatchResults(state.currentBatch, results), status: 'completed' as const }, saving: false, conflict: null }
  }),
  on(RouteActions.discardReviewBatch, (state) => ({ ...state, currentBatch: null, conflict: null, saving: false })),
  on(RouteActions.rebaseReviewBatchApply, (state, { routeVersions }) => {
    const batch = state.currentBatch
    if (!batch) return state
    const route = state.routes.find((item) => item.id === batch.routeId)
    if (!route) return { ...state, conflict: null }
    const affected = affectedSegmentIds(route, state.comments)
    const oldSegments = new Map(batch.segments.map((segment) => [segment.segmentId, segment]))
    const segments: BatchSegmentState[] = route.segments.map((segment) => {
      const isAffected = affected.has(segment.id)
      const old = oldSegments.get(segment.id)
      return {
        segmentId: segment.id,
        affected: isAffected,
        status: isAffected ? (old?.status === 'succeeded' ? 'succeeded' as const : 'pending' as const) : 'skipped' as const,
        opinion: isAffected ? (old?.opinion ?? null) : null,
        generatedCommentId: old?.generatedCommentId,
        error: undefined,
      }
    })
    return { ...state, conflict: null, currentBatch: { ...batch, baseVersion: routeVersions[batch.routeId] ?? batch.baseVersion, segments } }
  }),

  on(RouteActions.queueOfflineOpinion, (state, { routeId, segmentId, role, content }) => {
    const item: OutboxItem = {
      id: `OUT-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3).toString(36).toUpperCase()}`,
      routeId,
      segmentId,
      role,
      content,
      baseVersion: state.routeVersions[routeId] ?? 6,
      createdAt: new Date().toISOString(),
      status: 'pending',
    }
    return { ...state, outbox: [...state.outbox, item] }
  }),
  on(RouteActions.outboxItemMerged, (state, { id, commentId }) => ({
    ...state,
    outbox: state.outbox.map((item) => item.id === id ? { ...item, status: 'merged' as const, commentId } : item),
  })),
  on(RouteActions.outboxItemConflict, (state, { id, reason }) => ({
    ...state,
    outbox: state.outbox.map((item) => item.id === id ? { ...item, status: 'conflict' as const, reason } : item),
  })),
  on(RouteActions.removeOutboxItem, (state, { id }) => ({ ...state, outbox: state.outbox.filter((item) => item.id !== id) })),
  on(RouteActions.onlineStatusChanged, (state, { online }) => ({ ...state, online })),

  on(RouteActions.createAlternative, (state) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route),
  })),
)
