<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">
          围绕开口层位、现场/复核结论驱动「清理—测绘—解剖」阶段流转；口径由版本化策略统一求值，
          历史遗迹按原状态解释，复核结论优先于现场结论。
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
      empty-text="暂无遗迹单位数据"
      @retry="retry"
      @reset="reset"
      @clear-notice="clearNotice"
    />

    <template v-if="snapshot && hasData">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">遗迹总数</span>
          <strong class="stat-value">{{ snapshot.stats.featureTotal }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">清理中</span>
          <strong class="stat-value">{{ snapshot.stats.cleaning }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已完绘</span>
          <strong class="stat-value">{{ snapshot.stats.mapped }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': snapshot.stats.abnormalFeatures > 0 }">
          <span class="stat-label">异常待处理</span>
          <strong class="stat-value">{{ snapshot.stats.abnormalFeatures }}</strong>
        </article>
      </div>

      <p class="ws-policy-note">
        口径版本：<strong>2025 历史口径</strong>仅按阶段判断（历史遗迹）；
        <strong>2026 现行口径</strong>要求开口层位齐备且结论放行，复核结论优先于现场结论。
      </p>

      <table class="data-table ws-table">
        <thead>
          <tr>
            <th>遗迹编号</th>
            <th>所属探方</th>
            <th>类型</th>
            <th>开口层位</th>
            <th>阶段</th>
            <th>现场结论</th>
            <th>复核结论</th>
            <th>影像 / 图纸</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in snapshot.features" :key="row.record.id" :class="{ 'row-abnormal': row.abnormal }">
            <td>
              {{ row.record.code }}
              <span v-if="row.historical" class="tag tag-history" title="按阶段变更时的历史口径解释">历史</span>
            </td>
            <td>{{ row.record.trench || '—' }}</td>
            <td>{{ row.record.kind || '—' }}</td>
            <td>
              <span :class="{ 'cell-warn': row.record.openingLayerBackfilled }">
                {{ row.record.openingLayer || '—' }}
              </span>
            </td>
            <td>
              {{ row.stageLabel }}
              <span class="tag tag-policy">{{ row.policyLabel }}</span>
            </td>
            <td>
              <select
                class="ws-select"
                :value="row.record.siteConclusion"
                @change="onSite(row.record.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="unset">未下结论</option>
                <option value="proceed">同意继续</option>
                <option value="suspend">暂缓</option>
              </select>
            </td>
            <td>
              <select
                class="ws-select"
                :value="row.record.reviewConclusion"
                @change="onReview(row.record.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="unset">未复核</option>
                <option value="pass">复核通过</option>
                <option value="rework">要求返工</option>
                <option value="question">存疑</option>
              </select>
              <span v-if="row.conflict" class="tag tag-warn" title="已按复核结论优先处理">冲突·复核优先</span>
            </td>
            <td class="ws-att">
              <span :class="row.photos.ready ? 'att-ok' : 'att-bad'">
                影像：{{ labels.photoStateText(row.photos.state) }}
              </span>
              <span :class="row.drawings.ready ? 'att-ok' : 'att-bad'">
                图纸：{{ labels.drawingStateText(row.drawings.state) }}
              </span>
            </td>
            <td class="row-actions ws-gates">
              <button
                v-for="gate in gateOrder"
                :key="gate"
                class="link"
                type="button"
                :disabled="!row.gates[gate].available"
                :title="gateTitle(row.gates[gate].available, row.gates[gate].reasons.map(r => labels.gateReasonText(r.code)).join('；'))"
                @click="runGate(row.record.id, gate)"
              >
                {{ row.gates[gate].label }}
              </button>
              <ul v-if="row.abnormalReasons.length" class="ws-reasons">
                <li v-for="reasonText in row.abnormalReasons" :key="reasonText">{{ reasonText }}</li>
              </ul>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ snapshot.stats.featureTotal }} 条遗迹单位记录，口径在读取时统一求值</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import WorkspaceStateBanner from '@/components/WorkspaceStateBanner.vue'
import { useWorkspace, useWorkspaceLabels } from '@/composables/useWorkspace'
import type { GateKey } from '@/data/workspace/types'

const {
  snapshot,
  errorMessage,
  notice,
  hasData,
  refresh,
  retry,
  reset,
  runGate,
  setConclusion,
  clearNotice,
} = useWorkspace()

const labels = useWorkspaceLabels()
const gateOrder: GateKey[] = ['cleaning', 'mapping', 'dissection']

function onSite(id: number, value: string) {
  setConclusion(id, 'site', value)
}
function onReview(id: number, value: string) {
  setConclusion(id, 'review', value)
}

function gateTitle(available: boolean, reasonText: string): string {
  return available ? '按当前口径可执行' : reasonText
}

onMounted(refresh)
</script>
