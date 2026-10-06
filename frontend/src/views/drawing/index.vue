<template>
  <section class="page" data-module="drawing">
    <header class="page-head">
      <div>
        <h2>实测绘图管理</h2>
        <p class="page-desc">维护实测图纸，围绕图纸编号、绘图对象、绘图类型、比例尺做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记实测图纸</button>
        <button class="btn" type="button" @click="exportRows">导出实测绘图清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="loadKind === 'failed'" class="boundary-banner failed">
      {{ loadMessage }}
      <button class="link" type="button" @click="reload">重试</button>
    </p>
    <p v-else-if="loadKind !== 'ok'" class="boundary-banner">{{ loadMessage }}</p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            {{ row[column] ?? '—' }}
            <span
              v-if="column === '绘图对象' && attachmentOf(row).text"
              class="ref-badge"
              :class="attachmentOf(row).kind"
              :title="attachmentOf(row).title"
            >
              {{ attachmentOf(row).text }}
            </span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="action === '提交校核' && !submitGate(row).allowed"
              :title="action === '提交校核' ? submitGate(row).reason : ''"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无实测绘图数据，可先登记实测图纸</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条实测绘图记录</span>
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
import { drawingGate, type StageEligibility } from '@/domain/feature-workability'

const meta = moduleMeta('drawing')
const columns = ["图纸编号", "绘图对象", "绘图类型", "比例尺", "绘图人", "校核人", "完成日期", "图纸状态"]
const actions = ["提交校核", "确认校核", "退回修改"]
const statuses = ["绘制中", "待校核", "已校核", "已数字化", "需修改"]
const stats = [{"label": "图纸总数", "value": 0}, {"label": "已校核数", "value": 0}, {"label": "待校核数", "value": 0}]

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

// 绘图附件：绘图对象关联到遗迹时，亮出遗迹阶段；缺失 / 异常按统一边界标记
function attachmentOf(row: EntryRow): { kind: string; text: string; title: string } {
  const target = String(row['绘图对象'] ?? '').trim()
  if (!target) {
    return { kind: 'missing', text: '对象缺失', title: '绘图对象缺失，不能提交校核' }
  }
  const item = snapshot.value.byCode.get(target)
  if (!item) {
    return { kind: '', text: '', title: '' } // 非遗迹对象不标注
  }
  if (item.phase === 'unknown') {
    return { kind: 'abnormal', text: '状态异常', title: `关联遗迹 ${target} 状态无法识别` }
  }
  return { kind: 'ok', text: `遗迹·${item.status}`, title: `关联遗迹 ${target}，当前「${item.status}」` }
}

// 提交校核闸门与遗迹列表、影像待办读同一份阶段判定
function submitGate(row: EntryRow): StageEligibility {
  return drawingGate(row, snapshot.value.byCode)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '实测图纸登记入口尚未接入审批流'
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
  refresh()
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '实测绘图列表读取失败'
  }
}

onMounted(reload)
</script>
