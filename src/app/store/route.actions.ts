import { createAction, props } from '@ngrx/store'
import type { ReviewBatch, ReviewComment, ReviewSession, RiskLevel, RoutePackage, SaveConflict } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[]; versions: Record<string, number> }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const updatePermission = createAction('[Route Workbench] Update Permission', props<{ routeId: string; permission: RoutePackage['permission'] }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const commentSaved = createAction('[Route API] Comment Saved', props<{ id: string }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

// 运输单保存与多标签页冲突
export const saveRoute = createAction('[Route Workbench] Save Route', props<{ routeId: string }>())
export const saveRouteSuccess = createAction('[Route API] Save Route Success', props<{ routeId: string; version: number }>())
export const saveRouteFailure = createAction('[Route API] Save Route Failure', props<{ routeId: string; error: string }>())
export const saveRouteConflict = createAction('[Route API] Save Route Conflict', props<{ conflict: SaveConflict }>())
export const dismissConflict = createAction('[Route Workbench] Dismiss Conflict')

// 可恢复的路径复核批次
export const startReReview = createAction('[Review] Start ReReview Batch', props<{ batch: ReviewBatch }>())
export const segmentReviewSuccess = createAction('[Review] Segment Review Success', props<{ batchId: string; routeId: string; segmentId: string; comment: ReviewComment }>())
export const segmentReviewFailure = createAction('[Review] Segment Review Failure', props<{ batchId: string; routeId: string; segmentId: string; error: string }>())
export const resumeBatch = createAction('[Review] Resume Batch', props<{ batchId: string }>())

// 离线意见与网络恢复合并
export const queueOfflineComment = createAction('[Approval] Queue Offline Comment', props<{ comment: ReviewComment }>())
export const syncOfflineComments = createAction('[Network] Sync Offline Comments')
export const offlineCommentSynced = createAction('[Network] Offline Comment Synced', props<{ comment: ReviewComment }>())

// 审计基线与会话恢复
export const lockBaseline = createAction('[Approval] Lock Baseline', props<{ routeId: string }>())
export const restoreSession = createAction('[App] Restore Session')
export const sessionRestored = createAction('[App] Session Restored', props<ReviewSession>())
