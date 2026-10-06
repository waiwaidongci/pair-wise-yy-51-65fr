import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { ReviewComment, RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatProgressBarModule, MatChipsModule],
  template: `
    @if (state$ | async; as state) {
      <main class="page">
        <div class="page-head">
          <div>
            <p class="eyebrow">安全 · 运营 · 应急会签</p>
            <h1>逐区段审批与退回</h1>
            <p>每条意见锚定运输区段，原记录不可覆盖；许可或区段风险变更后相关会签立即失效，仅受影响区段生成补充意见，其余沿用原结论。</p>
          </div>
          <div class="head-actions">
            @if (state.baselines[state.selectedRouteId]; as baseline) {
              <mat-chip highlighted>基线已锁定 · v{{ baseline.version }}</mat-chip>
            }
            <button mat-flat-button color="primary" [disabled]="!!state.baselines[state.selectedRouteId] || state.saving" (click)="lockBaseline()">确认并锁定基线</button>
          </div>
        </div>

        @if (!state.online) {
          <div class="banner banner-offline">
            <b>当前离线</b>
            <span>填写的意见将暂存在本机，网络恢复后自动合并；基线锁定后离线意见不能覆盖基线。</span>
          </div>
        }

        @if (state.conflict; as conflict) {
          <div class="banner banner-conflict">
            @if (conflict.reason === 'version') {
              <b>运输单已被其他标签页保存到 v{{ conflict.serverVersion }}，您的草稿基于 v{{ conflict.baseVersion }}（后来保存的人先看到冲突）。</b>
              <span>重新加载后可保留已填写的区段意见并继续批次；放弃草稿则回到服务器版本。</span>
              <div class="banner-actions">
                <button mat-flat-button color="primary" (click)="rebase()">重新加载并保留意见</button>
                <button mat-stroked-button (click)="discardBatch()">放弃草稿</button>
              </div>
            } @else {
              <b>{{ conflict.message }}</b>
              <div class="banner-actions"><button mat-stroked-button (click)="clearConflict()">知道了</button></div>
            }
          </div>
        }

        <mat-tab-group>
          <mat-tab>
            <ng-template mat-tab-label>待处理意见 {{ activeComments(state).length ? '(' + activeComments(state).length + ')' : '' }}</ng-template>
            <section class="card comment-list">
              @for (comment of activeComments(state); track comment.id) {
                <div class="comment">
                  <div class="comment-head"><div><b>{{ comment.role }} · {{ comment.author }}</b><small>{{ comment.segmentId }} · {{ comment.id }} · {{ comment.kind }}</small></div><span>{{ comment.status }}</span></div>
                  <p>{{ comment.content }}</p>
                  <div class="actions">
                    <button mat-stroked-button color="warn" (click)="resolve(comment.id, '已退回')">退回补件</button>
                    <button mat-flat-button color="primary" (click)="resolve(comment.id, '已接受')">接受条件</button>
                  </div>
                </div>
              }
              @if (!activeComments(state).length) { <p class="empty">暂无待处理意见。</p> }
            </section>
            @if (invalidComments(state).length) {
              <h3 class="invalid-title">已失效 · 需重新会签</h3>
              <section class="card comment-list">
                @for (comment of invalidComments(state); track comment.id) {
                  <div class="comment invalid">
                    <div class="comment-head"><div><b>{{ comment.role }} · {{ comment.author }}</b><small>{{ comment.segmentId }} · {{ comment.id }} · {{ comment.kind }}</small></div><span class="status-invalid">{{ comment.status }}</span></div>
                    <p>{{ comment.content }}</p>
                    @if (comment.supersededBy) { <small class="superseded">已由补充意见 {{ comment.supersededBy }} 替代</small> }
                  </div>
                }
              </section>
            }
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>路径复核批次 {{ state.currentBatch ? '(' + batchProgress(state).done + '/' + batchProgress(state).total + ')' : '' }}</ng-template>
            @if (!state.currentBatch) {
              <section class="card batch-start">
                <h2>发起路径复核批次</h2>
                <p>许可或区段风险变更后，<b class="risk-high">{{ invalidSegmentCount(state) }} 个区段</b>的会签确认已失效。批次将只对这些区段生成补充意见，其余区段沿用原结论；保存失败时从最后成功区段恢复，已生成的补充意见不重复。</p>
                <button mat-flat-button color="primary" [disabled]="!invalidSegmentCount(state) || !!state.baselines[state.selectedRouteId]" (click)="startBatch()">开始复核批次</button>
                @if (!invalidSegmentCount(state)) { <p class="empty">当前没有失效会签，所有区段结论有效。</p> }
              </section>
            } @else {
              <section class="card">
                <div class="batch-head">
                  <div>
                    <h2>路径复核批次 {{ state.currentBatch.id }}</h2>
                    <p>运输单 {{ state.currentBatch.routeId }} · 草稿基于 v{{ state.currentBatch.baseVersion }}</p>
                  </div>
                  <span class="batch-status status-{{ state.currentBatch.status }}">{{ state.currentBatch.status === 'in-progress' ? '进行中' : state.currentBatch.status === 'failed' ? '保存中断' : '已完成' }}</span>
                </div>
                <mat-progress-bar mode="determinate" [value]="batchProgress(state).percent"></mat-progress-bar>
                <p class="progress-text">已生成补充意见 {{ batchProgress(state).done }} / {{ batchProgress(state).total }} 个受影响区段</p>

                @for (segment of state.currentBatch.segments; track segment.segmentId) {
                  <div class="batch-segment" [class.seg-done]="segment.status === 'succeeded'" [class.seg-failed]="segment.status === 'failed'">
                    <div class="seg-head">
                      <b>{{ segmentName(state, segment.segmentId) }}</b>
                      @if (segment.affected) { <span class="badge affected">受影响</span> } @else { <span class="badge skipped">沿用原结论</span> }
                      <span class="spacer"></span>
                      @switch (segment.status) {
                        @case ('succeeded') { <span class="seg-ok">✓ 已生成 {{ segment.generatedCommentId }}</span> }
                        @case ('failed') { <span class="seg-err">✗ 保存失败：{{ segment.error }}</span> }
                        @case ('pending') { <span class="seg-pending">待处理</span> }
                        @case ('skipped') { <span class="seg-pending">沿用原结论</span> }
                      }
                    </div>
                    @if (segment.affected) {
                      <div class="seg-opinion">
                        <mat-form-field><mat-label>专业角色</mat-label>
                          <mat-select [ngModel]="segment.opinion?.role" (ngModelChange)="updateOpinion(segment.segmentId, 'role', $event)">
                            <mat-option value="安全">安全</mat-option>
                            <mat-option value="运营">运营</mat-option>
                            <mat-option value="应急">应急</mat-option>
                          </mat-select>
                        </mat-form-field>
                        <mat-form-field class="wide"><mat-label>补充意见（针对变更后的风险 / 许可）</mat-label>
                          <textarea matInput rows="3" [ngModel]="segment.opinion?.content" (ngModelChange)="updateOpinion(segment.segmentId, 'content', $event)" placeholder="明确变更后的区段约束、时限与验收证据"></textarea>
                        </mat-form-field>
                      </div>
                    } @else {
                      <p class="seg-original">原结论：{{ originalComment(state, segment.segmentId)?.content || '—' }}</p>
                    }
                  </div>
                }

                <div class="batch-actions">
                  @if (state.currentBatch.status !== 'completed') {
                    @if (state.currentBatch.status === 'failed') {
                      <button mat-flat-button color="primary" [disabled]="state.saving || !canSave(state)" (click)="resumeBatch()">继续保存（从失败区段恢复）</button>
                    } @else {
                      <button mat-flat-button color="primary" [disabled]="state.saving || !canSave(state)" (click)="saveBatch()">提交批次保存</button>
                    }
                  }
                  <button mat-stroked-button (click)="discardBatch()">放弃批次</button>
                  @if (state.currentBatch.status === 'completed') { <span class="batch-done">批次已完成：补充意见已生成，其余区段沿用原结论。</span> }
                </div>
              </section>
            }
          </mat-tab>

          <mat-tab label="发表区段意见">
            <section class="card form-card">
              @if (!state.online) { <p class="offline-note">当前离线：提交后进入本机暂存，网络恢复后自动合并。</p> }
              @if (state.baselines[state.selectedRouteId]) { <p class="offline-note baseline-note">基线已锁定：意见不能覆盖已锁定基线。</p> }
              <div class="two">
                <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option value="安全">安全</mat-option><mat-option value="运营">运营</mat-option><mat-option value="应急">应急</mat-option></mat-select></mat-form-field>
                <mat-form-field><mat-label>区段</mat-label><mat-select [(ngModel)]="segmentId">@for (segment of allSegments(state); track segment.id) { <mat-option [value]="segment.id">{{ segment.id }} · {{ segment.name }}</mat-option> }</mat-select></mat-form-field>
              </div>
              <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据"></textarea></mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!content.trim() || !!state.baselines[state.selectedRouteId]" (click)="submitQuick(state)">{{ state.online ? '提交意见' : '离线暂存' }}</button>
            </section>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>离线暂存 {{ outboxPending(state) ? '(' + outboxPending(state) + ')' : '' }}</ng-template>
            <section class="card comment-list">
              @for (item of state.outbox; track item.id) {
                <div class="comment" [class.outbox-merged]="item.status === 'merged'" [class.outbox-conflict]="item.status === 'conflict'">
                  <div class="comment-head">
                    <div><b>{{ item.role }} · 离线暂存</b><small>{{ item.segmentId }} · {{ item.id }} · {{ item.createdAt }}</small></div>
                    @switch (item.status) {
                      @case ('pending') { <span class="seg-pending">待提交</span> }
                      @case ('merged') { <span class="seg-ok">✓ 已合并 {{ item.commentId }}</span> }
                      @case ('conflict') { <span class="seg-err">✗ 未合并</span> }
                    }
                  </div>
                  <p>{{ item.content }}</p>
                  @if (item.status === 'conflict') { <p class="conflict-reason">{{ item.reason }}</p> }
                  <div class="actions"><button mat-stroked-button (click)="removeOutbox(item.id)">移除</button></div>
                </div>
              }
              @if (!state.outbox.length) { <p class="empty">暂无离线暂存意见。断网时填写的意见会在这里排队，联网后自动合并。</p> }
            </section>
          </mat-tab>

          <mat-tab label="审计时间线">
            <section class="card timeline">
              <div><i></i><b>16:42 · 韩洁新增 S-203 限速与吸附物资要求</b><p>安全专业 · 修改前记录保留</p></div>
              <div><i></i><b>16:18 · 罗晋接受隧道出口监护条件</b><p>应急专业 · 审批意见已签章</p></div>
              <div><i></i><b>15:50 · 系统生成替代路径 R-ALT-02</b><p>规则引擎 · 风险分由 78 降至 71</p></div>
            </section>
          </mat-tab>
        </mat-tab-group>
      </main>
    }
  `,
  styles: [`
    .head-actions { display: flex; align-items: center; gap: 10px; }
    h2 { margin: 0 0 12px; }
    .comment-list { padding: 0; }
    .comment { padding: 18px; border-bottom: 1px solid #e7ebf1; }
    .comment.invalid { background: #fef2f2; border-left: 3px solid #dc2626; }
    .comment-head { display: flex; justify-content: space-between; gap: 10px; }
    .comment-head small { display: block; color: #7a8798; margin-top: 4px; }
    .comment p { color: #475569; margin: 6px 0; }
    .actions { display: flex; gap: 10px; }
    .actions button { margin: 8px 8px 0 0; }
    .form-card { max-width: 780px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .two mat-form-field, .wide { width: 100%; }
    .timeline { padding: 8px 18px; }
    .timeline > div { position: relative; padding: 14px 10px 14px 28px; border-left: 2px solid #cbd5e1; }
    .timeline i { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: #2563eb; left: -5.5px; top: 20px; }
    .timeline p { color: #7a8798; margin: 5px 0 0; }
    .empty { color: #7a8798; padding: 18px; margin: 0; }
    .invalid-title { margin: 18px 0 0; color: #991b1b; font-size: 15px; }
    .status-invalid { color: #dc2626; font-weight: 700; }
    .superseded { color: #7a8798; }
    .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; }
    .banner b { flex-basis: 100%; }
    .banner-offline { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .banner-conflict { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .banner-actions { display: flex; gap: 8px; margin-left: auto; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 700; }
    .badge.affected { background: #fef2f2; color: #dc2626; }
    .badge.skipped { background: #f0fdf4; color: #15803d; }
    .batch-start p { margin: 0 0 14px; }
    .batch-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
    .batch-head p { margin: 4px 0 0; color: #7a8798; }
    .batch-status { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .status-in-progress { background: #eff6ff; color: #2563eb; }
    .status-failed { background: #fef2f2; color: #dc2626; }
    .status-completed { background: #f0fdf4; color: #15803d; }
    .progress-text { margin: 8px 0 14px; color: #475569; font-size: 13px; }
    .batch-segment { border: 1px solid #e1e7ef; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
    .batch-segment.seg-done { border-color: #86efac; background: #f0fdf4; }
    .batch-segment.seg-failed { border-color: #fca5a5; background: #fef2f2; }
    .seg-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .seg-opinion { display: grid; grid-template-columns: 200px 1fr; gap: 14px; margin-top: 10px; }
    .seg-opinion mat-form-field { width: 100%; }
    .seg-original { margin: 8px 0 0; color: #475569; font-size: 13px; }
    .seg-ok { color: #15803d; font-size: 13px; font-weight: 600; }
    .seg-err { color: #dc2626; font-size: 13px; font-weight: 600; }
    .seg-pending { color: #7a8798; font-size: 13px; }
    .batch-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .batch-done { color: #15803d; font-size: 13px; font-weight: 600; }
    .offline-note { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 6px; margin: 0 0 12px; font-size: 13px; }
    .baseline-note { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
    .conflict-reason { color: #dc2626; font-size: 13px; margin: 4px 0 0; }
    .outbox-merged { background: #f0fdf4; }
    .outbox-conflict { background: #fef2f2; }
    @media (max-width: 620px) { .two, .seg-opinion { grid-template-columns: 1fr; } .banner-actions { margin-left: 0; } }
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  role = '安全'
  segmentId = 'S-203'
  content = ''

  startBatch() { this.store.dispatch(RouteActions.startReviewBatch()) }
  updateOpinion(segmentId: string, field: 'role' | 'content', value: string) { this.store.dispatch(RouteActions.updateBatchOpinion({ segmentId, field, value })) }
  saveBatch() { this.store.dispatch(RouteActions.saveReviewBatch()) }
  resumeBatch() { this.store.dispatch(RouteActions.resumeReviewBatch()) }
  discardBatch() { this.store.dispatch(RouteActions.discardReviewBatch()) }
  rebase() { this.store.dispatch(RouteActions.rebaseReviewBatch()) }
  clearConflict() { this.store.dispatch(RouteActions.clearConflict()) }
  lockBaseline() { this.store.dispatch(RouteActions.lockBaseline()) }
  removeOutbox(id: string) { this.store.dispatch(RouteActions.removeOutboxItem({ id })) }
  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }

  submitQuick(state: RouteState) {
    const text = this.content.trim()
    if (!text) return
    if (state.online) {
      this.store.dispatch(RouteActions.addComment({ comment: { id: `RV-${Date.now().toString().slice(-4)}`, segmentId: this.segmentId, role: this.role, author: '当前审阅人', content: text, status: '待确认', kind: '原结论' } }))
    } else {
      this.store.dispatch(RouteActions.queueOfflineOpinion({ routeId: state.selectedRouteId, segmentId: this.segmentId, role: this.role, content: text }))
    }
    this.content = ''
  }

  segmentName(state: RouteState, segmentId: string): string {
    for (const route of state.routes) {
      const segment = route.segments.find((item) => item.id === segmentId)
      if (segment) return segment.name
    }
    return segmentId
  }

  originalComment(state: RouteState, segmentId: string): ReviewComment | undefined {
    return [...state.comments].reverse().find((comment) => comment.segmentId === segmentId && comment.kind === '原结论' && comment.status !== '已失效' && comment.status !== '已替代')
  }

  activeComments(state: RouteState): ReviewComment[] {
    return state.comments.filter((comment) => comment.status !== '已失效' && comment.status !== '已替代')
  }

  invalidComments(state: RouteState): ReviewComment[] {
    return state.comments.filter((comment) => comment.status === '已失效' || comment.status === '已替代')
  }

  invalidSegmentCount(state: RouteState): number {
    return new Set(this.invalidComments(state).map((comment) => comment.segmentId)).size
  }

  batchProgress(state: RouteState): { done: number; total: number; percent: number } {
    const batch = state.currentBatch
    if (!batch) return { done: 0, total: 0, percent: 0 }
    const affected = batch.segments.filter((segment) => segment.affected)
    const done = affected.filter((segment) => segment.status === 'succeeded').length
    return { done, total: affected.length, percent: affected.length ? Math.round((done / affected.length) * 100) : 0 }
  }

  canSave(state: RouteState): boolean {
    const batch = state.currentBatch
    if (!batch) return false
    return batch.segments
      .filter((segment) => segment.affected && segment.status !== 'succeeded')
      .every((segment) => !!segment.opinion?.content.trim())
  }

  outboxPending(state: RouteState): number {
    return state.outbox.filter((item) => item.status === 'pending').length
  }

  allSegments(state: RouteState) {
    return state.routes.flatMap((route: RoutePackage) => route.segments)
  }
}
