import type {
  ConclusionResolution,
  FeatureRecord,
  FeatureStage,
  GateEvaluation,
  GateKey,
  GateReason,
  GateReasonCode,
  PhotoReadinessState,
  DrawingReadinessState,
  PhotoRecord,
  DrawingRecord,
  ReviewConclusion,
  SiteConclusion,
} from './types'

/**
 * 版本化阶段策略：一份口径，三处复用。
 *
 * 关键约束（需求原文）：
 * 1. 不是简单搬家 —— 历史遗迹按「阶段最后变更时生效的版本」解释，老记录保留原状态语义；
 * 2. 现场结论与复核结论冲突时，复核结论优先，同时保留冲突标记；
 * 3. 口径只在这里定义一次，遗迹列表 / 影像待办 / 绘图附件共用同一份求值。
 */

export const GATE_META: Record<GateKey, { label: string; targetStage: FeatureStage }> = {
  cleaning: { label: '开始清理', targetStage: 'cleaning' },
  mapping: { label: '完成测绘', targetStage: 'mapped' },
  dissection: { label: '执行解剖', targetStage: 'dissected' },
}

export const STAGE_LABEL: Record<FeatureStage, string> = {
  revealed: '已揭露',
  cleaning: '清理中',
  mapped: '已完绘',
  dissected: '已解剖',
  archived: '已归档',
}

export const SITE_LABEL: Record<SiteConclusion, string> = {
  unset: '未下结论',
  proceed: '现场同意继续',
  suspend: '现场暂缓',
}

export const REVIEW_LABEL: Record<ReviewConclusion, string> = {
  unset: '未复核',
  pass: '复核通过',
  rework: '复核要求返工',
  question: '复核存疑',
}

/** 阶段顺序索引：只有阶段到达动作的前置阶段时动作才可能开放 */
const STAGE_ORDER: Record<FeatureStage, number> = {
  revealed: 0,
  cleaning: 1,
  mapped: 2,
  dissected: 3,
  archived: 4,
}

/** 每个动作要求的最低阶段：清理要求已揭露、测绘要求清理中、解剖要求已完绘 */
const GATE_MIN_STAGE: Record<GateKey, FeatureStage> = {
  cleaning: 'revealed',
  mapping: 'cleaning',
  dissection: 'mapped',
}

type GateRule = {
  gate: GateKey
  /** 返回阻断原因；空数组表示结论维度放行 */
  reasons: (record: FeatureRecord) => GateReason[]
}

export type PolicyVersion = {
  id: string
  label: string
  /** 生效日（含），ISO yyyy-mm-dd；按遗迹阶段最后变更时间选择 */
  effectiveFrom: string
  gates: GateRule[]
}

const reason = (code: GateReasonCode, source: GateReason['source']): GateReason => ({ code, source })

/** 判定现场/复核综合结论：复核优先，冲突显式标注，其余供各动作取用 */
export function resolveConclusion(record: FeatureRecord): {
  resolution: ConclusionResolution
  conflict: boolean
} {
  const site = record.siteConclusion
  const review = record.reviewConclusion
  // 现场同意继续 与 复核非通过 并存即冲突；复核结论仍然优先
  const conflict = site === 'proceed' && (review === 'rework' || review === 'question')

  if (review === 'rework') {
    return { resolution: { kind: 'blocked', reason: 'review-rework', source: 'review' }, conflict }
  }
  if (review === 'question') {
    return { resolution: { kind: 'hold', reason: 'review-question' }, conflict }
  }
  if (review === 'pass') {
    return { resolution: { kind: 'allowed' }, conflict }
  }

  // 尚无复核结论时才看现场结论
  if (site === 'suspend') {
    return { resolution: { kind: 'blocked', reason: 'site-suspended', source: 'site' }, conflict }
  }
  if (site === 'proceed') {
    return { resolution: { kind: 'allowed' }, conflict }
  }
  return { resolution: { kind: 'pending' }, conflict }
}

/* ------------------------------------------------------------------ */
/* 2025 历史口径：只看阶段本身，不看开口层位与复核结论                  */
/* 老遗迹「按原状态解释」，不拿今天的新规矩去卡它                       */
/* ------------------------------------------------------------------ */
const POLICY_V1: PolicyVersion = {
  id: 'policy-2025',
  label: '2025 历史口径',
  effectiveFrom: '2025-01-01',
  gates: (['cleaning', 'mapping', 'dissection'] as GateKey[]).map((gate) => ({
    gate,
    reasons: () => [],
  })),
}

/* ------------------------------------------------------------------ */
/* 2026 现行口径：开口层位 + 现场/复核结论共同决定，复核优先            */
/* ------------------------------------------------------------------ */
function openingLayerReasons(record: FeatureRecord): GateReason[] {
  if (!record.openingLayer.trim() || record.openingLayerBackfilled) {
    return [reason('missing-opening-layer', 'data')]
  }
  return []
}

const POLICY_V2: PolicyVersion = {
  id: 'policy-2026',
  label: '2026 现行口径',
  effectiveFrom: '2026-01-01',
  gates: [
    {
      gate: 'cleaning',
      reasons: (r) => {
        const out = openingLayerReasons(r)
        const { resolution } = resolveConclusion(r)
        // 清理是动手的第一步：结论必须明确放行，暂缓/返工/存疑/未下结论一律不动土
        if (resolution.kind !== 'allowed') {
          out.push(
            resolution.kind === 'pending'
              ? reason('conclusion-pending', 'site')
              : resolution.kind === 'hold'
                ? reason('review-question', 'review')
                : reason(resolution.reason, resolution.source),
          )
        }
        return out
      },
    },
    {
      gate: 'mapping',
      reasons: (r) => {
        const out = openingLayerReasons(r)
        const { resolution } = resolveConclusion(r)
        // 测绘只排除明确的阻断项；复核存疑可以先画、画完再裁
        if (resolution.kind === 'blocked') {
          out.push(reason(resolution.reason, resolution.source))
        }
        return out
      },
    },
    {
      gate: 'dissection',
      reasons: (r) => {
        const out = openingLayerReasons(r)
        const { resolution } = resolveConclusion(r)
        // 解剖是破坏性作业：放行结论必须确定，复核存疑不得下刀
        if (resolution.kind !== 'allowed') {
          out.push(
            resolution.kind === 'pending'
              ? reason('conclusion-pending', 'site')
              : resolution.kind === 'hold'
                ? reason('review-question', 'review')
                : reason(resolution.reason, resolution.source),
          )
        }
        return out
      },
    },
  ],
}

/** 按生效时间从早到晚排列，选择时取「不晚于目标日期」的最新一版 */
const POLICIES: PolicyVersion[] = [POLICY_V1, POLICY_V2]

export function policyForDate(dateIso: string): PolicyVersion {
  const date = dateIso.slice(0, 10)
  let chosen = POLICIES[0]
  for (const policy of POLICIES) {
    if (date >= policy.effectiveFrom) {
      chosen = policy
    }
  }
  return chosen
}

const GATE_REASON_TEXT: Record<GateReasonCode, string> = {
  'stage-not-ready': '阶段未到，需先完成前序作业',
  'already-reached': '该阶段已完成，无需重复执行',
  'missing-opening-layer': '缺少开口层位（旧数据待回填）',
  'conclusion-pending': '现场结论尚未给出',
  'site-suspended': '现场结论为暂缓',
  'review-rework': '复核要求返工，优先执行复核结论',
  'review-question': '复核存疑，需核实后再继续',
}

export function gateReasonText(code: GateReasonCode): string {
  return GATE_REASON_TEXT[code]
}

/** 阶段 + 版本规则求值单个动作 */
export function evaluateGate(record: FeatureRecord, gate: GateKey, policy: PolicyVersion): GateEvaluation {
  const meta = GATE_META[gate]
  const stageIndex = STAGE_ORDER[record.stage]
  const minIndex = STAGE_ORDER[GATE_MIN_STAGE[gate]]
  const targetIndex = STAGE_ORDER[meta.targetStage]

  const reached = stageIndex >= targetIndex
  const reasons: GateReason[] = []

  if (reached) {
    reasons.push(reason('already-reached', 'stage'))
  } else if (stageIndex < minIndex) {
    reasons.push(reason('stage-not-ready', 'stage'))
  } else {
    const rule = policy.gates.find((item) => item.gate === gate)
    reasons.push(...(rule ? rule.reasons(record) : []))
  }

  return {
    key: gate,
    label: meta.label,
    targetStage: meta.targetStage,
    reached,
    available: reasons.length === 0,
    reasons,
    policyId: policy.id,
    policyLabel: policy.label,
  }
}

export function evaluateAllGates(record: FeatureRecord): Record<GateKey, GateEvaluation> {
  const policy = policyForDate(record.stageUpdatedAt)
  return {
    cleaning: evaluateGate(record, 'cleaning', policy),
    mapping: evaluateGate(record, 'mapping', policy),
    dissection: evaluateGate(record, 'dissection', policy),
  }
}

/* ------------------------------------------------------------------ */
/* 影像 / 图纸齐备度：口径同样只此一份，被三处页面共用                   */
/* ------------------------------------------------------------------ */
export function photoReadiness(photos: PhotoRecord[]): {
  state: PhotoReadinessState
  ready: boolean
} {
  if (photos.length === 0) return { state: 'missing', ready: false }
  const statuses = photos.map((p) => p.status)
  if (statuses.some((s) => s === '需重拍')) return { state: 'needs-retake', ready: false }
  if (statuses.some((s) => s === '已拍摄')) return { state: 'pending-number', ready: false }
  if (statuses.every((s) => s === '已编号' || s === '已归档')) {
    return { state: 'ready', ready: true }
  }
  return { state: 'pending-number', ready: false }
}

export function drawingReadiness(drawings: DrawingRecord[]): {
  state: DrawingReadinessState
  ready: boolean
} {
  if (drawings.length === 0) return { state: 'missing', ready: false }
  const statuses = drawings.map((d) => d.status)
  if (statuses.some((s) => s === '需修改')) return { state: 'needs-rework', ready: false }
  if (statuses.some((s) => s === '绘制中')) return { state: 'drafting', ready: false }
  if (statuses.some((s) => s === '待校核')) return { state: 'pending-review', ready: false }
  if (statuses.every((s) => s === '已校核' || s === '已数字化')) {
    return { state: 'ready', ready: true }
  }
  return { state: 'drafting', ready: false }
}

export const PHOTO_STATE_TEXT: Record<PhotoReadinessState, string> = {
  missing: '缺影像',
  'pending-number': '待编号',
  'needs-retake': '需重拍',
  ready: '影像齐备',
}

export const DRAWING_STATE_TEXT: Record<DrawingReadinessState, string> = {
  missing: '缺图纸',
  drafting: '绘制中',
  'pending-review': '待校核',
  'needs-rework': '需修改',
  ready: '图纸齐备',
}
