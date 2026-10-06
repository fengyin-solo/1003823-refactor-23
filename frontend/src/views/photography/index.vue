<template>
  <section class="page" data-module="photography">
    <header class="page-head">
      <div>
        <h2>影像记录 · 待办</h2>
        <p class="page-desc">
          影像齐备度与遗迹列表读同一份策略快照：缺影像、待编号、需重拍自动汇入待办，
          未关联遗迹的影像单独隔离，不在遗迹口径里误算。
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
      empty-text="暂无遗迹单位数据，影像待办无法归集"
      @retry="retry"
      @reset="reset"
      @clear-notice="clearNotice"
    />

    <template v-if="snapshot && hasData">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">影像档案总数</span>
          <strong class="stat-value">{{ snapshot.photos.length }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': snapshot.stats.photoTodo > 0 }">
          <span class="stat-label">影像待办遗迹</span>
          <strong class="stat-value">{{ snapshot.stats.photoTodo }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': snapshot.unlinkedPhotos.length > 0 }">
          <span class="stat-label">未关联影像</span>
          <strong class="stat-value">{{ snapshot.unlinkedPhotos.length }}</strong>
        </article>
      </div>

      <h3 class="ws-section-title">按遗迹归集的影像待办</h3>
      <table class="data-table ws-table">
        <thead>
          <tr>
            <th>遗迹编号</th>
            <th>阶段（口径）</th>
            <th>影像状态</th>
            <th>关联影像</th>
            <th>待办说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in snapshot.features" :key="row.record.id" :class="{ 'row-abnormal': !row.photos.ready }">
            <td>
              {{ row.record.code }}
              <span v-if="row.historical" class="tag tag-history">历史</span>
            </td>
            <td>{{ row.stageLabel }} · {{ row.policyLabel }}</td>
            <td :class="row.photos.ready ? 'att-ok' : 'att-bad'">
              {{ labels.photoStateText(row.photos.state) }}
            </td>
            <td class="ws-att-list">
              <span v-if="!row.photos.items.length" class="att-bad">无关联影像</span>
              <span v-for="photo in row.photos.items" :key="photo.id" class="ws-chip">
                {{ photo.code }}（{{ photo.status }}）
              </span>
            </td>
            <td>{{ row.photos.ready ? '—' : photoTodoText(row.photos.state) }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="ws-section-title">影像档案处理</h3>
      <table class="data-table ws-table">
        <thead>
          <tr>
            <th>影像编号</th>
            <th>关联遗迹</th>
            <th>类型 / 方位</th>
            <th>拍摄日期</th>
            <th>摄影人员</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="photo in photoRows" :key="photo.id" :class="{ 'row-warn': photo.status === '需重拍' }">
            <td>{{ photo.code }}</td>
            <td>
              <span v-if="isLinked(photo.featureCode)">{{ photo.featureCode }}</span>
              <span v-else class="tag tag-warn">未关联·待补遗迹</span>
            </td>
            <td>{{ photo.kind || '—' }} / {{ photo.bearing || '—' }}</td>
            <td>{{ photo.shotAt || '—' }}</td>
            <td>{{ photo.operator || '—' }}</td>
            <td>{{ photo.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" :disabled="photo.status !== '已拍摄'" @click="runPhoto(photo.id, '分配编号')">分配编号</button>
              <button class="link" type="button" :disabled="photo.status !== '已编号'" @click="runPhoto(photo.id, '提交归档')">提交归档</button>
              <button class="link" type="button" :disabled="photo.status === '需重拍'" @click="runPhoto(photo.id, '安排重拍')">安排重拍</button>
            </td>
          </tr>
          <tr v-if="!photoRows.length">
            <td colspan="7" class="empty-state">暂无影像档案</td>
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
import type { PhotoReadinessState } from '@/data/workspace/types'

const {
  snapshot,
  errorMessage,
  notice,
  hasData,
  refresh,
  retry,
  reset,
  runPhoto,
  clearNotice,
} = useWorkspace()

const labels = useWorkspaceLabels()

const photoRows = computed(() => snapshot.value?.photos ?? [])

const linkedCodes = computed(
  () => new Set((snapshot.value?.features ?? []).map((f) => f.record.code)),
)
function isLinked(code: string): boolean {
  return code !== '' && linkedCodes.value.has(code)
}

const PHOTO_TODO_TEXT: Record<PhotoReadinessState, string> = {
  missing: '补拍并登记影像',
  'pending-number': '已拍摄影像需分配编号后归档',
  'needs-retake': '存在需重拍影像，重拍前不计齐备',
  ready: '—',
}
function photoTodoText(state: PhotoReadinessState): string {
  return PHOTO_TODO_TEXT[state]
}

onMounted(refresh)
</script>
