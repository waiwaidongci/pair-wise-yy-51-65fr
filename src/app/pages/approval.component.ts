import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段审批与退回</h1><p>每条意见锚定运输区段，原记录不可覆盖，所有确认写入审计时间线。</p></div><button mat-flat-button color="primary" (click)="lockBaseline()">确认并锁定基线</button></div>
      @if ((state$ | async)?.notice; as notice) { <div class="banner ok">{{notice}}</div> }
      @for (baseline of (state$ | async)?.baselines || []; track baseline.routeId) {
        @if (baseline.locked) { <div class="banner locked"><b>基线已锁定</b><span>{{baseline.routeId}} · v{{baseline.version}} · {{baseline.lockedAt}} · 区段结论与审批意见只读保存，离线合并不会覆盖</span></div> }
      }
      @for (batch of (state$ | async)?.batches || []; track batch.id) {
        @if (batch.status !== '已完成') {
          <div class="banner batch" [class.paused]="batch.status === '已暂停'">
            <b>复核批次 {{batch.id}}</b><span>{{batch.reason}} · 受影响区段 {{batch.cursor}}/{{batch.queue.length}} 已重算</span>
            @if (batch.status === '已暂停') { <span class="warn">{{batch.error}}</span><button mat-stroked-button color="primary" (click)="resume(batch.id)">从断点继续</button> }
          </div>
        }
      }
      <mat-tab-group>
        <mat-tab label="待处理意见"><section class="card comment-list">
          @for (comment of (state$ | async)?.comments || []; track comment.id) {
            <div class="comment" [class.invalid]="comment.status === '已失效'"><div class="comment-head"><div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.segmentId}} · {{comment.id}}<span class="tag" *ngIf="comment.batchId">补充意见</span><span class="tag offline" *ngIf="comment.offline">离线待同步</span></small></div><span [class.warn]="comment.status === '已失效'">{{comment.status}}</span></div><p>{{comment.content}}</p>
            <div class="actions" *ngIf="comment.status !== '已失效'"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" (click)="resolve(comment.id,'已接受')">接受条件</button></div></div>
          }
        </section></mat-tab>
        <mat-tab label="发表区段意见"><section class="card form-card">
          <div class="two"><mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field><mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.name}}</mat-option></mat-select></mat-form-field></div>
          <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
          <p class="hint" *ngIf="!online">当前离线：意见将先进入待同步队列，网络恢复后自动合并，不会覆盖已锁定基线。</p>
          <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">{{ online ? '提交意见' : '离线保存意见' }}</button>
        </section></mat-tab>
        <mat-tab label="离线待同步 ({{ (state$ | async)?.offlineQueue?.length || 0 }})"><section class="card comment-list">
          <div class="comment" *ngFor="let item of (state$ | async)?.offlineQueue || []; trackBy: trackById"><div class="comment-head"><div><b>{{item.role}} · {{item.author}}</b><small>{{item.segmentId}} · {{item.id}}</small></div><span>待同步</span></div><p>{{item.content}}</p></div>
          <p class="hint empty" *ngIf="!(state$ | async)?.offlineQueue?.length">暂无离线意见。网络恢复后队列自动合并，按意见 ID 幂等，不产生重复。</p>
          <button mat-stroked-button color="primary" [disabled]="!(state$ | async)?.offlineQueue?.length" (click)="syncNow()">立即同步</button>
        </section></mat-tab>
        <mat-tab label="审计时间线"><section class="card timeline">
          <div><i></i><b>16:42 · 韩洁新增 S-203 限速与吸附物资要求</b><p>安全专业 · 修改前记录保留</p></div>
          <div><i></i><b>16:18 · 罗晋接受隧道出口监护条件</b><p>应急专业 · 审批意见已签章</p></div>
          <div><i></i><b>15:50 · 系统生成替代路径 R-ALT-02</b><p>规则引擎 · 风险分由 78 降至 71</p></div>
        </section></mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1}.comment.invalid{opacity:.62}.comment-head{display:flex;justify-content:space-between}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#7a8798;margin:5px 0 0}
    .tag{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:9px;background:#dbeafe;color:#1e40af;font-size:11px}.tag.offline{background:#fef3c7;color:#92400e}.warn{color:#b91c1c}.hint{color:#7a8798;font-size:12px}.hint.empty{padding:18px;margin:0}
    .banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;border-radius:8px;margin-bottom:14px;font-size:13px}.banner b{flex-shrink:0}
    .banner.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.banner.locked{background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6}
    .banner.batch{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}.banner.batch.paused{background:#fffbeb;border-color:#fde68a;color:#92400e}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  role = '安全'
  segmentId = 'S-203'
  content = ''
  online = navigator.onLine
  selectedRouteId = ''
  segments: RouteState['routes'][number]['segments'] = []
  constructor() {
    this.state$.subscribe((state) => { this.segments = state.routes.flatMap((route: RoutePackage) => route.segments); this.selectedRouteId = state.selectedRouteId })
    window.addEventListener('online', () => { this.online = true })
    window.addEventListener('offline', () => { this.online = false })
  }
  addComment() {
    const comment = { id: `RV-${Date.now().toString().slice(-6)}`, segmentId: this.segmentId, routeId: this.selectedRouteId, role: this.role, author: '当前审阅人', content: this.content, status: '待确认' as const }
    // 离线时先入待同步队列，网络恢复后由同步效果合并；在线时正常提交，保存失败自动转离线队列
    this.store.dispatch(this.online ? RouteActions.addComment({ comment }) : RouteActions.queueOfflineComment({ comment: { ...comment, offline: true } }))
    this.content = ''
  }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
  resume(batchId: string) { this.store.dispatch(RouteActions.resumeBatch({ batchId })) }
  syncNow() { this.store.dispatch(RouteActions.syncOfflineComments()) }
  lockBaseline() { if (this.selectedRouteId) this.store.dispatch(RouteActions.lockBaseline({ routeId: this.selectedRouteId })) }
  trackById(_: number, item: { id: string }) { return item.id }
}
