export type RiskLevel = '高' | '中' | '低'

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
  permission: '有效' | '缺失' | '待补充'
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
  status: '待确认' | '已接受' | '已退回' | '已失效'
  routeId?: string
  batchId?: string
  offline?: boolean
}

export interface ReviewBatch {
  id: string
  routeId: string
  reason: string
  queue: string[]
  cursor: number
  status: '进行中' | '已暂停' | '已完成'
  error: string
}

export interface RouteBaseline {
  routeId: string
  version: number
  locked: boolean
  lockedAt: string
  segments: Record<string, { level: RiskLevel; status: RiskSegment['status']; risks: string[] }>
}

export interface SaveConflict {
  routeId: string
  localVersion: number
  serverVersion: number
}

export interface ReviewSession {
  batches: ReviewBatch[]
  baselines: RouteBaseline[]
  offlineQueue: ReviewComment[]
}
