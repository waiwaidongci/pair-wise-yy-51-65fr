import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { delay, map, of, throwError } from 'rxjs'
import type { ReviewComment, ReviewSession, RoutePackage } from '../types'

export class RouteConflictError extends Error {
  constructor(readonly serverVersion: number) { super('运输单版本冲突') }
}

const BASE_VERSION = 6
const SESSION_KEY = 'hazmat.session'

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  getRoutePackages() {
    return this.http.get<{ items: RoutePackage[] }>('route-data.json').pipe(map((response) => response.items))
  }

  /** 读取服务端（此处以 localStorage 模拟，多标签页共享）上各运输单的版本号 */
  getServerVersions(routeIds: string[]): Record<string, number> {
    const versions: Record<string, number> = {}
    for (const id of routeIds) versions[id] = Number(localStorage.getItem(`hazmat.version.${id}`) ?? BASE_VERSION)
    return versions
  }

  /** 乐观并发提交：服务端版本与本地基线不一致时拒绝，后保存的一方收到冲突 */
  commitRoute(routeId: string, expectedVersion: number) {
    if (!navigator.onLine) return throwError(() => new Error('网络离线，运输单保存失败，请联网后重试'))
    const serverVersion = Number(localStorage.getItem(`hazmat.version.${routeId}`) ?? BASE_VERSION)
    if (serverVersion !== expectedVersion) return throwError(() => new RouteConflictError(serverVersion))
    localStorage.setItem(`hazmat.version.${routeId}`, String(expectedVersion + 1))
    return of({ version: expectedVersion + 1 }).pipe(delay(200))
  }

  /** 保存单条区段复核意见；按意见 ID 幂等，重试与断点恢复不会产生重复记录 */
  saveSegmentReview(routeId: string, comment: ReviewComment) {
    if (!navigator.onLine) return throwError(() => new Error('网络离线，区段复核保存中断'))
    const key = `hazmat.reviews.${routeId}`
    const saved: ReviewComment[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!saved.some((item) => item.id === comment.id)) localStorage.setItem(key, JSON.stringify([...saved, comment]))
    return of(comment).pipe(delay(250))
  }

  loadSession(): ReviewSession {
    const fallback: ReviewSession = { batches: [], baselines: [], offlineQueue: [] }
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') }
    } catch {
      return fallback
    }
  }

  saveSession(session: ReviewSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
}
