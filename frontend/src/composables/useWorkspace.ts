import { computed, ref } from 'vue'

import {
  PHOTO_STATE_TEXT,
  DRAWING_STATE_TEXT,
  REVIEW_LABEL,
  SITE_LABEL,
  STAGE_LABEL,
  gateReasonText,
} from '@/data/workspace/policy'
import { workspaceService, type WorkspaceService } from '@/data/workspace/service'
import type {
  MutationResult,
  PhotoRecord,
  DrawingRecord,
  ReviewConclusion,
  SiteConclusion,
  WorkspaceSnapshot,
} from '@/data/workspace/types'

/**
 * 三处入口（遗迹列表 / 影像待办 / 绘图附件）共用的页面状态。
 *
 * 统一边界（需求点名）：
 * - 只有一份 snapshot，任何动作成功后整体刷新，三处读到同一结果；
 * - 读取失败/结构异常：snapshot=null，页面显示失败态并提供「重试」「重置」；
 * - 空态、未关联缺失、单条异常都来自快照里的显式字段，不在页面各写一套判断；
 * - 所有写动作失败都走 applyResult，消息统一收口，且失败不改本地状态（不存在写一半）。
 */

export function useWorkspace(service: WorkspaceService = workspaceService()) {
  const snapshot = ref<WorkspaceSnapshot | null>(null)
  const errorMessage = ref('')
  const notice = ref('')

  function refresh(source?: MutationResult<WorkspaceSnapshot>): void {
    if (source && !source.ok) {
      snapshot.value = null
      errorMessage.value = source.message
      return
    }
    try {
      snapshot.value = service.snapshot()
      errorMessage.value = ''
    } catch (error) {
      snapshot.value = null
      errorMessage.value = error instanceof Error ? error.message : '遗迹工作区读取失败'
    }
  }

  function retry(): void {
    errorMessage.value = ''
    notice.value = ''
    refresh(service.reload())
  }

  function reset(): void {
    notice.value = ''
    const result = service.resetWorkspace()
    if (result.ok) {
      snapshot.value = result.data
      errorMessage.value = ''
      notice.value = result.message
    } else {
      applyResult(result)
    }
  }

  function applyResult(result: MutationResult): void {
    if (result.ok) {
      notice.value = result.message
      errorMessage.value = ''
      refresh()
      return
    }
    errorMessage.value = result.retryable ? `${result.message}，可点「重试」或再次执行` : result.message
  }

  function runGate(id: number, gate: 'cleaning' | 'mapping' | 'dissection'): void {
    notice.value = ''
    applyResult(service.advanceFeature(id, gate))
  }

  function setConclusion(id: number, kind: 'site' | 'review', value: string): void {
    notice.value = ''
    applyResult(service.setConclusion(id, kind, value as SiteConclusion | ReviewConclusion))
  }

  function runPhoto(id: number, action: string): void {
    notice.value = ''
    applyResult(service.photoAction(id, action))
  }

  function runDrawing(id: number, action: string): void {
    notice.value = ''
    applyResult(service.drawingAction(id, action))
  }

  function clearNotice(): void {
    notice.value = ''
  }

  const hasData = computed(() => (snapshot.value?.features.length ?? 0) > 0)

  return {
    snapshot,
    errorMessage,
    notice,
    hasData,
    refresh,
    retry,
    reset,
    runGate,
    setConclusion,
    runPhoto,
    runDrawing,
    clearNotice,
  }
}

/** 展示辅助：标签与原因文案也从策略层取，页面不重复造口径 */
export function useWorkspaceLabels() {
  return {
    stageLabel: (stage: keyof typeof STAGE_LABEL) => STAGE_LABEL[stage],
    siteLabel: (value: SiteConclusion) => SITE_LABEL[value],
    reviewLabel: (value: ReviewConclusion) => REVIEW_LABEL[value],
    photoStateText: (state: keyof typeof PHOTO_STATE_TEXT) => PHOTO_STATE_TEXT[state],
    drawingStateText: (state: keyof typeof DRAWING_STATE_TEXT) => DRAWING_STATE_TEXT[state],
    gateReasonText,
  }
}

export type { PhotoRecord, DrawingRecord }
