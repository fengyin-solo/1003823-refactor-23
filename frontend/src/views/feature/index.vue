<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">维护遗迹，围绕遗迹编号、所属探方、遗迹类型、开口层位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遗迹</button>
        <button class="btn" type="button" @click="exportRows">导出遗迹单位清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="loadKind === 'failed'" class="boundary-banner failed">
      {{ loadMessage }}
      <button class="link" type="button" @click="reload">重试</button>
    </p>
    <p v-else-if="loadKind !== 'ok'" class="boundary-banner">{{ loadMessage }}</p>
    <template v-else>
      <p v-if="snapshot.backfilledCount" class="boundary-banner">
        已自动回填 {{ snapshot.backfilledCount }} 条历史遗迹的开口层位 / 判定口径，请核对后再继续操作
      </p>
      <p v-if="snapshot.abnormalCount" class="boundary-banner failed">
        {{ snapshot.abnormalCount }} 条遗迹状态无法识别，已按异常边界处理，请先修正数据
      </p>
    </template>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>阶段判定</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="stage-cell">
            <span
              v-for="stage in stageBadges(row)"
              :key="stage.label"
              class="stage-badge"
              :class="{ on: stage.allowed }"
              :title="stage.reason"
            >
              {{ stage.label }}
            </span>
            <span v-if="ruleVersionOf(row)" class="rule-tag" title="判定口径版本：历史遗迹按登记时口径解释">
              {{ ruleVersionOf(row) }}
            </span>
            <span
              v-for="marker in markersOf(row)"
              :key="marker.text"
              class="row-marker"
              :title="marker.title"
            >
              {{ marker.text }}
            </span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!actionGate(row, action).allowed"
              :title="actionGate(row, action).reason"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无遗迹单位数据，可先登记遗迹</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useFeatureWorkability } from '@/composables/use-feature-workability'
import type { EntryRow } from '@/data/types'
import { featureActionStage, type StageEligibility, type StageKey } from '@/domain/feature-workability'

const meta = moduleMeta('feature')
const columns = ["遗迹编号", "所属探方", "遗迹类型", "开口层位", "打破关系", "平面形状", "填土特征", "记录状态"]
const actions = ["开始清理", "完成测绘", "执行解剖"]
const statuses = ["已揭露", "清理中", "已完绘", "已解剖", "已归档"]
const stats = [{"label": "遗迹总数", "value": 0}, {"label": "清理中遗迹", "value": 0}, {"label": "已完绘遗迹", "value": 0}]

const STAGE_BADGES: { key: StageKey; label: string }[] = [
  { key: 'clean', label: '可清理' },
  { key: 'survey', label: '可测绘' },
  { key: 'dissect', label: '可解剖' },
]

const { snapshot, loadKind, loadMessage, refresh } = useFeatureWorkability()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function stageBadges(row: EntryRow) {
  const item = snapshot.value.byId.get(Number(row.id))
  return STAGE_BADGES.map(({ key, label }) => ({
    label,
    allowed: item?.stages[key].allowed ?? false,
    reason: item ? item.stages[key].reason || `${label}：当前可执行` : '阶段判定不可用，请先重试加载',
  }))
}

function ruleVersionOf(row: EntryRow): string {
  return snapshot.value.byId.get(Number(row.id))?.ruleVersion ?? ''
}

function markersOf(row: EntryRow): { text: string; title: string }[] {
  const item = snapshot.value.byId.get(Number(row.id))
  if (!item) {
    return []
  }
  const markers: { text: string; title: string }[] = []
  if (item.phase === 'unknown') {
    markers.push({ text: '状态异常', title: `状态「${item.status}」不在已知流转内` })
  }
  if (item.conclusion.conflict) {
    markers.push({
      text: '结论冲突',
      title: `现场「${item.conclusion.field}」/ 复核「${item.conclusion.review}」，按复核结论执行`,
    })
  }
  if (item.openingStratumBackfilled) {
    markers.push(
      item.openingStratum === '待补录'
        ? { text: '层位待补录', title: '开口层位缺失且所属探方无层位可回填，请补录' }
        : { text: '层位回填', title: `开口层位由所属探方层位回填为「${item.openingStratum}」，请核对` },
    )
  }
  return markers
}

function actionGate(row: EntryRow, action: string): StageEligibility {
  const stage = featureActionStage(action)
  const item = snapshot.value.byId.get(Number(row.id))
  if (!stage || !item) {
    return { allowed: true, reason: '' }
  }
  return item.stages[stage]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遗迹登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  // 先跑回填迁移再读列表，保证页面看到的是回填后的数据
  refresh()
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(reload)
</script>
