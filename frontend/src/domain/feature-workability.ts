import type { EntryRow } from '@/data/types'

/**
 * 遗迹「可清理 / 可测绘 / 可解剖」阶段判定：全系统唯一一份口径。
 * 遗迹列表、影像待办、绘图附件都读这里的判定结果，改阶段规则只改这个文件，
 * 不再允许三个入口各自解释状态。
 */

// 判定口径版本：历史遗迹按登记时的版本解释（钉在 v1），新登记遗迹用现行版本。
// 版本只钉不改，保证任何一条旧记录都能按原状态重新解释。
export const LEGACY_RULE_VERSION = 'v1'
export const CURRENT_RULE_VERSION = 'v2'
export type RuleVersion = typeof LEGACY_RULE_VERSION | typeof CURRENT_RULE_VERSION

// 开口层位回填：旧数据缺开口层位时先从所属探方补，补不上就标这个值，
// 涉及层位的阶段一律拦住，而不是当成空字符串放行。
export const OPENING_STRATUM_TODO = '待补录'

export type FeaturePhase = 'revealed' | 'cleaning' | 'mapped' | 'dissected' | 'archived' | 'unknown'

export type StageKey = 'clean' | 'survey' | 'dissect'

export type StageEligibility = { allowed: boolean; reason: string }

export type ConclusionResolution = {
  field: string // 现场结论，原样保留
  review: string // 复核结论，原样保留
  effective: string // 生效结论：复核优先，现场兜底，两边都没有就是空
  source: 'review' | 'field' | 'none'
  conflict: boolean // 现场与复核都录了且不一致：按复核执行，但必须亮出来
}

export type FeatureWorkability = {
  id: number
  code: string // 遗迹编号，影像记录与实测图纸靠它关联
  status: string
  phase: FeaturePhase
  ruleVersion: RuleVersion
  conclusion: ConclusionResolution
  openingStratum: string
  openingStratumBackfilled: boolean
  stages: Record<StageKey, StageEligibility>
}

export type FeatureWorkabilitySnapshot = {
  items: FeatureWorkability[]
  byId: ReadonlyMap<number, FeatureWorkability>
  byCode: ReadonlyMap<string, FeatureWorkability>
  backfilledCount: number
  abnormalCount: number
}

const PHASE_BY_STATUS: Record<string, FeaturePhase> = {
  已揭露: 'revealed',
  清理中: 'cleaning',
  已完绘: 'mapped',
  已解剖: 'dissected',
  已归档: 'archived',
}

const STAGE_BY_ACTION: Record<string, StageKey> = {
  开始清理: 'clean',
  完成测绘: 'survey',
  执行解剖: 'dissect',
}

const ELIGIBLE: StageEligibility = { allowed: true, reason: '' }

function blocked(reason: string): StageEligibility {
  return { allowed: false, reason }
}

export function featureActionStage(action: string): StageKey | null {
  return STAGE_BY_ACTION[action] ?? null
}

/** 结论优先级：复核结论 > 现场结论。冲突时两边都保留、按复核执行、并标记冲突。 */
export function resolveConclusion(row: EntryRow): ConclusionResolution {
  const field = String(row['现场结论'] ?? '').trim()
  const review = String(row['复核结论'] ?? '').trim()
  if (review) {
    return { field, review, effective: review, source: 'review', conflict: field !== '' && field !== review }
  }
  if (field) {
    return { field, review, effective: field, source: 'field', conflict: false }
  }
  return { field, review, effective: '', source: 'none', conflict: false }
}

function normalizeVersion(raw: unknown): RuleVersion {
  // 只有显式钉了现行版本的才按 v2 解释；缺失或无法识别的版本一律按历史口径，
  // 宁可放宽也不让旧数据被新规则误伤。
  return raw === CURRENT_RULE_VERSION ? CURRENT_RULE_VERSION : LEGACY_RULE_VERSION
}

/**
 * 旧数据回填（纯函数，不改入参）：
 * - 缺口径版本的钉到 v1，历史遗迹继续按原状态解释；
 * - 缺开口层位的先用所属探方的发掘层位补，补不上标「待补录」。
 * 返回 changed=false 时 rows 就是入参原数组，调用方不用落盘。
 */
export function migrateFeatureRows(
  rows: EntryRow[],
  trenches: EntryRow[],
): { rows: EntryRow[]; changed: boolean } {
  const stratumByTrench = new Map(
    trenches.map((trench) => [String(trench['探方编号'] ?? ''), String(trench['发掘层位'] ?? '').trim()]),
  )
  let changed = false
  const next = rows.map((row) => {
    const patched = { ...row }
    if (!patched['口径版本']) {
      patched['口径版本'] = LEGACY_RULE_VERSION
      changed = true
    }
    if (!String(patched['开口层位'] ?? '').trim()) {
      const source = stratumByTrench.get(String(patched['所属探方'] ?? '').trim())
      patched['开口层位'] = source || OPENING_STRATUM_TODO
      patched['开口层位回填'] = source ? '探方层位' : OPENING_STRATUM_TODO
      changed = true
    }
    return patched
  })
  return changed ? { rows: next, changed: true } : { rows, changed: false }
}

/** 单条遗迹的阶段判定：三处入口（列表 / 影像待办 / 绘图附件）共用的那一份结果。 */
export function assessFeature(row: EntryRow): FeatureWorkability {
  const status = String(row.status ?? '')
  const ruleVersion = normalizeVersion(row['口径版本'])
  const openingStratum = String(row['开口层位'] ?? '').trim()
  const conclusion = resolveConclusion(row)
  const phase = PHASE_BY_STATUS[status] ?? 'unknown'
  const modern = ruleVersion === CURRENT_RULE_VERSION
  const stratumMissing = openingStratum === '' || openingStratum === OPENING_STRATUM_TODO

  // v1（历史口径）：只按状态解释，和当年各入口的判断一致，旧记录含义不变。
  // v2（现行口径）：开口层位不清不得动土；解剖不可逆，必须有明确结论放行。
  const stages: Record<StageKey, StageEligibility> = {
    clean:
      phase !== 'revealed'
        ? blocked(`当前状态「${status || '未知'}」不在待清理阶段`)
        : modern && stratumMissing
          ? blocked('开口层位缺失（待补录），不能开始清理')
          : modern && conclusion.effective === '暂缓清理'
            ? blocked(`结论为「暂缓清理」（${conclusion.source === 'review' ? '复核' : '现场'}结论）`)
            : ELIGIBLE,
    survey:
      phase !== 'cleaning'
        ? blocked('清理未完成，不到测绘阶段')
        : modern && stratumMissing
          ? blocked('开口层位缺失（待补录），不能完成测绘')
          : ELIGIBLE,
    dissect:
      phase !== 'mapped'
        ? blocked('测绘未完成，不到解剖阶段')
        : modern && conclusion.source === 'none'
          ? blocked('缺少现场/复核结论，不能执行解剖')
          : modern && conclusion.effective !== '可解剖'
            ? blocked(`结论为「${conclusion.effective}」，不能执行解剖`)
            : ELIGIBLE,
  }

  return {
    id: Number(row.id),
    code: String(row['遗迹编号'] ?? '').trim(),
    status,
    phase,
    ruleVersion,
    conclusion,
    openingStratum,
    openingStratumBackfilled: Boolean(row['开口层位回填']),
    stages,
  }
}

export type PhotographyTodo = {
  featureCode: string
  status: string
  note: string
}

// 这些状态的影像算「已覆盖」；需重拍不算，仍进待办。
const PHOTO_COVERING_STATUSES = ['已拍摄', '已编号', '已归档']

/** 影像待办：还在野外作业阶段（待清理 / 清理中）且没有有效影像的遗迹。 */
export function photographyTodos(items: FeatureWorkability[], photos: EntryRow[]): PhotographyTodo[] {
  const covering = new Set(
    photos
      .filter((photo) => PHOTO_COVERING_STATUSES.includes(String(photo.status)))
      .map((photo) => String(photo['拍摄对象'] ?? '').trim()),
  )
  return items
    .filter((item) => item.phase === 'revealed' || item.phase === 'cleaning')
    .filter((item) => item.code !== '' && !covering.has(item.code))
    .map((item) => ({
      featureCode: item.code,
      status: item.status,
      note: item.phase === 'revealed' ? '清理前影像待拍' : '清理过程影像待拍',
    }))
}

/** 绘图附件闸门：关联遗迹的图纸，测绘没完成不能提交校核；对象缺失按缺失边界拦住。 */
export function drawingGate(
  drawing: EntryRow,
  byCode: ReadonlyMap<string, FeatureWorkability>,
): StageEligibility {
  const target = String(drawing['绘图对象'] ?? '').trim()
  if (!target) {
    return blocked('绘图对象缺失，不能提交校核')
  }
  const feature = byCode.get(target)
  if (!feature) {
    return ELIGIBLE // 非遗迹对象（探方、地层等）按通用流程，不用遗迹口径卡
  }
  if (feature.phase === 'unknown') {
    return blocked(`关联遗迹 ${target} 状态异常，不能提交校核`)
  }
  if (feature.phase === 'revealed' || feature.phase === 'cleaning') {
    return blocked(`关联遗迹 ${target} 尚在「${feature.status}」，测绘未完成`)
  }
  return ELIGIBLE
}
