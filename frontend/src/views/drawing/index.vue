<template>
  <section class="page" data-module="drawing">
    <header class="page-head">
      <div>
        <h2>实测绘图 · 附件</h2>
        <p class="page-desc">
          图纸齐备度与遗迹列表、影像待办读同一份策略快照：缺图纸、绘制中、待校核、需修改都会挂到对应遗迹，
          未关联遗迹的图纸单独隔离，测绘、解剖动作以这份齐备度为参考边界。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="retry">重新加载</button>
        <button class="btn ghost" type="button" @click="reset">重置工作区</button>
      </div>
    </header>

    <WorkspaceStateBanner
      :error-message="errorMessage"
      :notice="notice"
      :is-empty="!errorMessage && !hasData"
      empty-text="暂无遗迹单位数据，绘图附件无法归集"
      @retry="retry"
      @reset="reset"
      @clear-notice="clearNotice"
    />

    <template v-if="snapshot && hasData">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">实测图纸总数</span>
          <strong class="stat-value">{{ snapshot.drawings.length }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': snapshot.stats.drawingTodo > 0 }">
          <span class="stat-label">图纸待办遗迹</span>
          <strong class="stat-value">{{ snapshot.stats.drawingTodo }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': snapshot.unlinkedDrawings.length > 0 }">
          <span class="stat-label">未关联图纸</span>
          <strong class="stat-value">{{ snapshot.unlinkedDrawings.length }}</strong>
        </article>
      </div>

      <h3 class="ws-section-title">按遗迹归集的图纸附件</h3>
      <table class="data-table ws-table">
        <thead>
          <tr>
            <th>遗迹编号</th>
            <th>阶段（口径）</th>
            <th>图纸状态</th>
            <th>关联图纸</th>
            <th>附件待办</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in snapshot.features" :key="row.record.id" :class="{ 'row-abnormal': !row.drawings.ready }">
            <td>
              {{ row.record.code }}
              <span v-if="row.historical" class="tag tag-history">历史</span>
            </td>
            <td>{{ row.stageLabel }} · {{ row.policyLabel }}</td>
            <td :class="row.drawings.ready ? 'att-ok' : 'att-bad'">
              {{ labels.drawingStateText(row.drawings.state) }}
            </td>
            <td class="ws-att-list">
              <span v-if="!row.drawings.items.length" class="att-bad">无关联图纸</span>
              <span v-for="drawing in row.drawings.items" :key="drawing.id" class="ws-chip">
                {{ drawing.code }}（{{ drawing.status }}）
              </span>
            </td>
            <td>{{ row.drawings.ready ? '—' : drawingTodoText(row.drawings.state) }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="ws-section-title">图纸校核处理</h3>
      <table class="data-table ws-table">
        <thead>
          <tr>
            <th>图纸编号</th>
            <th>关联遗迹</th>
            <th>类型 / 比例尺</th>
            <th>绘图人</th>
            <th>校核人</th>
            <th>完成日期</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="drawing in drawingRows" :key="drawing.id" :class="{ 'row-warn': drawing.status === '需修改' }">
            <td>{{ drawing.code }}</td>
            <td>
              <span v-if="isLinked(drawing.featureCode)">{{ drawing.featureCode }}</span>
              <span v-else class="tag tag-warn">未关联·待补遗迹</span>
            </td>
            <td>{{ drawing.kind || '—' }} / {{ drawing.scale || '—' }}</td>
            <td>{{ drawing.drawer || '—' }}</td>
            <td>{{ drawing.reviewer || '—' }}</td>
            <td>{{ drawing.finishedAt || '—' }}</td>
            <td>{{ drawing.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" :disabled="drawing.status !== '绘制中' && drawing.status !== '需修改'" @click="runDrawing(drawing.id, '提交校核')">提交校核</button>
              <button class="link" type="button" :disabled="drawing.status !== '待校核'" @click="runDrawing(drawing.id, '确认校核')">确认校核</button>
              <button class="link" type="button" :disabled="drawing.status !== '待校核'" @click="runDrawing(drawing.id, '退回修改')">退回修改</button>
            </td>
          </tr>
          <tr v-if="!drawingRows.length">
            <td colspan="8" class="empty-state">暂无实测图纸</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import WorkspaceStateBanner from '@/components/WorkspaceStateBanner.vue'
import { useWorkspace, useWorkspaceLabels } from '@/composables/useWorkspace'
import type { DrawingReadinessState } from '@/data/workspace/types'

const {
  snapshot,
  errorMessage,
  notice,
  hasData,
  refresh,
  retry,
  reset,
  runDrawing,
  clearNotice,
} = useWorkspace()

const labels = useWorkspaceLabels()

const drawingRows = computed(() => snapshot.value?.drawings ?? [])

const linkedCodes = computed(
  () => new Set((snapshot.value?.features ?? []).map((f) => f.record.code)),
)
function isLinked(code: string): boolean {
  return code !== '' && linkedCodes.value.has(code)
}

const DRAWING_TODO_TEXT: Record<DrawingReadinessState, string> = {
  missing: '补绘该遗迹的实测图纸',
  drafting: '图纸仍在绘制，需提交校核',
  'pending-review': '图纸待校核，校核通过后计入齐备',
  'needs-rework': '图纸被退回修改，修改后重新提交',
  ready: '—',
}
function drawingTodoText(state: DrawingReadinessState): string {
  return DRAWING_TODO_TEXT[state]
}

onMounted(refresh)
</script>
