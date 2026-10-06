import { createAction, props } from '@ngrx/store'
import type { Baseline, BatchItemResult, ConflictInfo, ReviewComment, RiskLevel, RoutePackage } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())

/** 服务端状态同步（首次加载、跨标签页 storage 同步、变更后刷新） */
export const serverStateChanged = createAction('[Server] State Changed', props<{ routes: RoutePackage[]; comments: ReviewComment[]; routeVersions: Record<string, number>; baselines: Record<string, Baseline> }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

export const changePermit = createAction('[Workspace] Change Permit', props<{ routeId: string; permit: string; permission: RoutePackage['permission'] }>())
export const changeSegmentRisk = createAction('[Risk Map] Change Segment Risk', props<{ routeId: string; segmentId: string; level: RiskLevel }>())

/** 乐观锁冲突 / 基线锁定冲突：后来保存的人先看到冲突 */
export const mutationConflict = createAction('[Server] Mutation Conflict', props<{ conflict: ConflictInfo }>())
export const clearConflict = createAction('[Approval] Clear Conflict')

export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())

/** 可恢复批次：只处理受影响区段，其余沿用原结论 */
export const startReviewBatch = createAction('[Approval] Start Review Batch')
export const updateBatchOpinion = createAction('[Approval] Update Batch Opinion', props<{ segmentId: string; field: 'role' | 'content'; value: string }>())
export const saveReviewBatch = createAction('[Approval] Save Review Batch')
export const resumeReviewBatch = createAction('[Approval] Resume Review Batch')
export const reviewBatchProgress = createAction('[Server] Review Batch Progress', props<{ results: BatchItemResult[] }>())
export const reviewBatchCompleted = createAction('[Server] Review Batch Completed', props<{ results: BatchItemResult[]; version: number }>())
export const discardReviewBatch = createAction('[Approval] Discard Review Batch')
export const rebaseReviewBatch = createAction('[Approval] Rebase Review Batch')
export const rebaseReviewBatchApply = createAction('[Approval] Rebase Review Batch Apply', props<{ routeVersions: Record<string, number> }>())

export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 离线意见暂存与联网合并 */
export const queueOfflineOpinion = createAction('[Approval] Queue Offline Opinion', props<{ routeId: string; segmentId: string; role: string; content: string }>())
export const flushOutbox = createAction('[Outbox] Flush')
export const outboxItemMerged = createAction('[Outbox] Item Merged', props<{ id: string; commentId: string }>())
export const outboxItemConflict = createAction('[Outbox] Item Conflict', props<{ id: string; reason: string }>())
export const removeOutboxItem = createAction('[Outbox] Remove Item', props<{ id: string }>())

export const onlineStatusChanged = createAction('[Network] Online Status Changed', props<{ online: boolean }>())

export const createAlternative = createAction('[Risk Map] Create Alternative')
