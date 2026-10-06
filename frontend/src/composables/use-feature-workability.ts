import { ref } from 'vue'

import type { BoundaryKind } from '@/api/boundary'
import { loadFeatureWorkability } from '@/api/local-service'
import type { FeatureWorkabilitySnapshot } from '@/domain/feature-workability'

const EMPTY_SNAPSHOT: FeatureWorkabilitySnapshot = {
  items: [],
  byId: new Map(),
  byCode: new Map(),
  backfilledCount: 0,
  abnormalCount: 0,
}

/**
 * 遗迹阶段判定的统一入口：遗迹列表、影像待办、绘图附件都用它拿同一份结果，
 * 空态 / 缺失 / 异常 / 失败（可重试）也按同一套边界处理，页面不各自解释。
 */
export function useFeatureWorkability() {
  const snapshot = ref<FeatureWorkabilitySnapshot>(EMPTY_SNAPSHOT)
  const loadKind = ref<BoundaryKind>('ok')
  const loadMessage = ref('')

  function refresh(): void {
    const result = loadFeatureWorkability()
    loadKind.value = result.kind
    if (result.kind === 'ok') {
      snapshot.value = result.value
      loadMessage.value = ''
    } else {
      // 非 ok 一律退回空快照：页面只看到统一边界，不会读到半份数据
      snapshot.value = EMPTY_SNAPSHOT
      loadMessage.value = result.message
    }
  }

  return { snapshot, loadKind, loadMessage, refresh }
}
