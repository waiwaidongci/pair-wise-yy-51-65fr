export type RiskLevel = '高' | '中' | '低'

export type PermissionStatus = '有效' | '缺失' | '待补充'

export type CommentStatus = '待确认' | '已接受' | '已退回' | '已失效' | '已替代'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: PermissionStatus
  score: number
  updatedAt: string
  segments: RiskSegment[]
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: CommentStatus
  /** 原结论（会签时给出）还是补充意见（失效后重新会签生成） */
  kind: '原结论' | '补充意见'
  /** 补充意见替代的旧意见 id */
  supersedes?: string
  /** 旧意见被哪条补充意见替代 */
  supersededBy?: string
  /** 幂等键：批次保存为 `${batchId}:${segmentId}`，离线意见为 `outbox:${itemId}` */
  idempotencyKey?: string
  createdAt?: string
}

/** 锁定基线：锁定后任何变更都不能覆盖 */
export interface Baseline {
  id: string
  routeId: string
  lockedAt: string
  lockedBy: string
  version: number
}

export type ConflictReason = 'version' | 'baseline-locked' | 'not-found' | 'segment-missing'

export interface ConflictInfo {
  routeId: string
  baseVersion: number
  serverVersion: number
  reason: ConflictReason
  message: string
}

/** 离线意见暂存项，网络恢复后合并 */
export interface OutboxItem {
  id: string
  routeId: string
  segmentId: string
  role: string
  content: string
  baseVersion: number
  createdAt: string
  status: 'pending' | 'merged' | 'conflict'
  reason?: string
  commentId?: string
}

export interface BatchSegmentState {
  segmentId: string
  /** 受影响区段（有失效会签）需生成补充意见；其余沿用原结论 */
  affected: boolean
  status: 'pending' | 'succeeded' | 'failed' | 'skipped'
  opinion: { role: string; content: string } | null
  generatedCommentId?: string
  error?: string
}

export interface ReviewBatch {
  id: string
  routeId: string
  /** 批次草稿基于的运输单版本，用于乐观锁冲突检测 */
  baseVersion: number
  status: 'in-progress' | 'failed' | 'completed'
  segments: BatchSegmentState[]
  startedAt: string
}

export interface BatchItemResult {
  segmentId: string
  status: 'succeeded' | 'failed'
  commentId?: string
  deduped?: boolean
  error?: string
}

/** 服务端状态（localStorage 持久化，跨标签页通过 storage 事件同步） */
export interface ServerState {
  routes: RoutePackage[]
  comments: ReviewComment[]
  routeVersions: Record<string, number>
  baselines: Record<string, Baseline>
  batchAttempts: Record<string, number>
}
