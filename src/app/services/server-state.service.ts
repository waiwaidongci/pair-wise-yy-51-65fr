import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import type { Baseline, BatchItemResult, ConflictInfo, OutboxItem, ReviewComment, RiskLevel, RoutePackage, ServerState } from '../types'

const SERVER_STATE_KEY = 'raildata-server-v1'

const SEED_COMMENTS: ReviewComment[] = [
  { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', kind: '原结论' },
  { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', kind: '原结论' },
]

const clamp = (min: number, max: number, value: number): number => Math.min(max, Math.max(min, value))
const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4).toString(36).toUpperCase()}`

export interface SaveBatchItem {
  segmentId: string
  role: string
  content: string
  idempotencyKey: string
}

export interface SaveBatchResult {
  ok: boolean
  results: BatchItemResult[]
  version?: number
  conflict?: ConflictInfo
}

export interface MutationResult {
  ok: boolean
  version?: number
  conflict?: ConflictInfo
}

export interface OutboxFlushResult {
  id: string
  status: 'merged' | 'conflict'
  commentId?: string
  reason?: string
}

/**
 * 模拟后端：localStorage 持久化 + 跨标签页 storage 事件同步。
 * - 每条运输单有独立版本号，变更走乐观锁（版本不一致返回 conflict）
 * - 批次保存逐区段处理，幂等键去重；每个批次首次保存确定性失败一次，用于演示从最后成功区段恢复
 * - 基线锁定后拒绝一切覆盖性变更
 */
@Injectable({ providedIn: 'root' })
export class ServerStateService {
  private readonly stateSubject = new BehaviorSubject<ServerState>(this.readState())
  readonly state$ = this.stateSubject.asObservable()

  constructor() {
    window.addEventListener('storage', (event) => {
      if (event.key === SERVER_STATE_KEY) this.stateSubject.next(this.readState())
    })
  }

  private readState(): ServerState {
    try {
      const raw = localStorage.getItem(SERVER_STATE_KEY)
      if (raw) return JSON.parse(raw) as ServerState
    } catch { /* 落盘数据损坏时按空状态处理 */ }
    return { routes: [], comments: [], routeVersions: {}, baselines: {}, batchAttempts: {} }
  }

  private writeState(state: ServerState): void {
    localStorage.setItem(SERVER_STATE_KEY, JSON.stringify(state))
    this.stateSubject.next(state)
  }

  load(): ServerState {
    return this.readState()
  }

  /** 首次启动时用静态数据播种；已有服务端状态则保留（不覆盖） */
  seedIfEmpty(routes: RoutePackage[]): void {
    if (localStorage.getItem(SERVER_STATE_KEY)) return
    const routeVersions: Record<string, number> = {}
    routes.forEach((route) => { routeVersions[route.id] = 6 })
    this.writeState({ routes, comments: SEED_COMMENTS.map((comment) => ({ ...comment })), routeVersions, baselines: {}, batchAttempts: {} })
  }

  private versionConflict(routeId: string, baseVersion: number, serverVersion: number): ConflictInfo {
    return { routeId, baseVersion, serverVersion, reason: 'version', message: '运输单已被其他标签页更新' }
  }

  private baselineConflict(routeId: string, baseVersion: number, baseline: Baseline): ConflictInfo {
    return { routeId, baseVersion, serverVersion: baseline.version, reason: 'baseline-locked', message: '基线已锁定，变更不能覆盖已锁定基线' }
  }

  private notFoundConflict(routeId: string, baseVersion: number): ConflictInfo {
    return { routeId, baseVersion, serverVersion: 0, reason: 'not-found', message: '运输单不存在或已被移除' }
  }

  /** 许可变更：该单所有会签意见失效，风险分重算 */
  changePermit(req: { routeId: string; permit: string; permission: RoutePackage['permission']; baseVersion: number }): MutationResult {
    const state = this.readState()
    const route = state.routes.find((item) => item.id === req.routeId)
    if (!route) return { ok: false, conflict: this.notFoundConflict(req.routeId, req.baseVersion) }
    const baseline = state.baselines[req.routeId]
    if (baseline) return { ok: false, conflict: this.baselineConflict(req.routeId, req.baseVersion, baseline) }
    const serverVersion = state.routeVersions[req.routeId] ?? 0
    if (serverVersion !== req.baseVersion) return { ok: false, conflict: this.versionConflict(req.routeId, req.baseVersion, serverVersion) }

    const wasValid = route.permission === '有效'
    const nowValid = req.permission === '有效'
    route.permit = req.permit
    route.permission = req.permission
    if (wasValid !== nowValid) route.score = clamp(40, 100, route.score + (nowValid ? -10 : 10))

    const segmentIds = new Set(route.segments.map((segment) => segment.id))
    state.comments = state.comments.map((comment) => segmentIds.has(comment.segmentId) ? { ...comment, status: '已失效' as const } : comment)
    state.routeVersions[req.routeId] = serverVersion + 1
    this.writeState(state)
    return { ok: true, version: state.routeVersions[req.routeId] }
  }

  /** 区段风险变更：仅该区段会签意见失效，风险分重算 */
  changeSegmentRisk(req: { routeId: string; segmentId: string; level: RiskLevel; baseVersion: number }): MutationResult {
    const state = this.readState()
    const route = state.routes.find((item) => item.id === req.routeId)
    if (!route) return { ok: false, conflict: this.notFoundConflict(req.routeId, req.baseVersion) }
    const baseline = state.baselines[req.routeId]
    if (baseline) return { ok: false, conflict: this.baselineConflict(req.routeId, req.baseVersion, baseline) }
    const serverVersion = state.routeVersions[req.routeId] ?? 0
    if (serverVersion !== req.baseVersion) return { ok: false, conflict: this.versionConflict(req.routeId, req.baseVersion, serverVersion) }
    const segment = route.segments.find((item) => item.id === req.segmentId)
    if (!segment) return { ok: false, conflict: { routeId: req.routeId, baseVersion: req.baseVersion, serverVersion, reason: 'segment-missing', message: '区段不存在或已被移除' } }

    segment.level = req.level
    segment.status = req.level === '高' ? '需绕行' : req.level === '中' ? '待复核' : '已确认'
    route.score = clamp(40, 100, route.score + (req.level === '高' ? 6 : req.level === '低' ? -4 : 0))
    state.comments = state.comments.map((comment) => comment.segmentId === req.segmentId ? { ...comment, status: '已失效' as const } : comment)
    state.routeVersions[req.routeId] = serverVersion + 1
    this.writeState(state)
    return { ok: true, version: state.routeVersions[req.routeId] }
  }

  /**
   * 批次保存：逐区段生成补充意见。
   * - 幂等键去重：已生成的补充意见直接返回，不重复创建
   * - 每个批次首次保存时确定性失败一次（第二个区段），续传时从断点继续
   * - 全部成功后运输单版本 +1；失败时版本不动
   */
  saveBatch(req: { batchId: string; routeId: string; baseVersion: number; items: SaveBatchItem[] }): SaveBatchResult {
    const state = this.readState()
    const route = state.routes.find((item) => item.id === req.routeId)
    if (!route) return { ok: false, results: [], conflict: this.notFoundConflict(req.routeId, req.baseVersion) }
    const baseline = state.baselines[req.routeId]
    if (baseline) return { ok: false, results: [], conflict: this.baselineConflict(req.routeId, req.baseVersion, baseline) }
    const serverVersion = state.routeVersions[req.routeId] ?? 0
    if (serverVersion !== req.baseVersion) return { ok: false, results: [], conflict: this.versionConflict(req.routeId, req.baseVersion, serverVersion) }

    const attempt = state.batchAttempts[req.batchId] ?? 0
    const results: BatchItemResult[] = []
    let failed = false
    for (let i = 0; i < req.items.length; i++) {
      const item = req.items[i]
      if (attempt === 0 && i === Math.min(1, req.items.length - 1)) {
        results.push({ segmentId: item.segmentId, status: 'failed', error: 'NETWORK' })
        failed = true
        break
      }
      const existing = state.comments.find((comment) => comment.idempotencyKey === item.idempotencyKey)
      if (existing) {
        results.push({ segmentId: item.segmentId, status: 'succeeded', commentId: existing.id, deduped: true })
        continue
      }
      const superseded = state.comments.filter((comment) => comment.segmentId === item.segmentId && comment.status === '已失效')
      const comment: ReviewComment = {
        id: newId('RV'),
        segmentId: item.segmentId,
        role: item.role,
        author: '当前审阅人',
        content: item.content,
        status: '待确认',
        kind: '补充意见',
        supersedes: superseded[0]?.id,
        idempotencyKey: item.idempotencyKey,
        createdAt: new Date().toISOString(),
      }
      state.comments = state.comments.map((c) => superseded.some((old) => old.id === c.id) ? { ...c, status: '已替代' as const, supersededBy: comment.id } : c)
      state.comments.push(comment)
      results.push({ segmentId: item.segmentId, status: 'succeeded', commentId: comment.id })
    }
    state.batchAttempts[req.batchId] = attempt + 1
    if (!failed) state.routeVersions[req.routeId] = serverVersion + 1
    this.writeState(state)
    return { ok: !failed, results, version: failed ? undefined : state.routeVersions[req.routeId] }
  }

  /** 锁定基线：锁定后所有覆盖性变更被拒绝 */
  lockBaseline(req: { routeId: string; baseVersion: number; lockedBy: string }): MutationResult {
    const state = this.readState()
    const route = state.routes.find((item) => item.id === req.routeId)
    if (!route) return { ok: false, conflict: this.notFoundConflict(req.routeId, req.baseVersion) }
    if (state.baselines[req.routeId]) return { ok: false, conflict: { routeId: req.routeId, baseVersion: req.baseVersion, serverVersion: state.baselines[req.routeId].version, reason: 'baseline-locked', message: '基线已锁定，不能重复锁定' } }
    const serverVersion = state.routeVersions[req.routeId] ?? 0
    if (serverVersion !== req.baseVersion) return { ok: false, conflict: this.versionConflict(req.routeId, req.baseVersion, serverVersion) }
    state.baselines[req.routeId] = { id: newId('BL'), routeId: req.routeId, lockedAt: new Date().toISOString(), lockedBy: req.lockedBy, version: serverVersion }
    this.writeState(state)
    return { ok: true, version: serverVersion }
  }

  /**
   * 离线意见合并：逐条幂等合并。
   * 基线锁定 → 冲突（不能覆盖基线）；区段不存在 → 冲突；幂等键命中 → 直接合并不重复创建。
   */
  flushOutbox(items: OutboxItem[]): OutboxFlushResult[] {
    const state = this.readState()
    const results: OutboxFlushResult[] = []
    for (const item of items) {
      const route = state.routes.find((r) => r.id === item.routeId)
      if (state.baselines[item.routeId]) {
        results.push({ id: item.id, status: 'conflict', reason: '基线已锁定，离线意见不能覆盖基线' })
        continue
      }
      if (!route || !route.segments.some((segment) => segment.id === item.segmentId)) {
        results.push({ id: item.id, status: 'conflict', reason: '运输单或区段已不存在' })
        continue
      }
      const key = `outbox:${item.id}`
      const existing = state.comments.find((comment) => comment.idempotencyKey === key)
      if (existing) {
        results.push({ id: item.id, status: 'merged', commentId: existing.id })
        continue
      }
      const superseded = state.comments.filter((comment) => comment.segmentId === item.segmentId && comment.status === '已失效')
      const comment: ReviewComment = {
        id: newId('RV'),
        segmentId: item.segmentId,
        role: item.role,
        author: '离线审阅人',
        content: item.content,
        status: '待确认',
        kind: '补充意见',
        supersedes: superseded[0]?.id,
        idempotencyKey: key,
        createdAt: item.createdAt,
      }
      state.comments = state.comments.map((c) => superseded.some((old) => old.id === c.id) ? { ...c, status: '已替代' as const, supersededBy: comment.id } : c)
      state.comments.push(comment)
      results.push({ id: item.id, status: 'merged', commentId: comment.id })
    }
    this.writeState(state)
    return results
  }
}
