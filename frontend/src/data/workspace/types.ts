/**
 * 遗迹工作区：遗迹单位、影像档案、实测图纸三方共用的领域模型。
 *
 * 设计原则：记录里只存「事实」（阶段、开口层位、现场/复核结论、关联档案状态），
 * 「可清理 / 可测绘 / 可解剖」以及影像、图纸齐备度一律在读取时由策略引擎派生，
 * 三处页面读到的永远是同一次求值的结果，不会出现各入口口径漂移。
 */

/** 遗迹阶段：已揭露 → 清理中 → 已完绘 → 已解剖 → 已归档 */
export type FeatureStage = 'revealed' | 'cleaning' | 'mapped' | 'dissected' | 'archived'

/** 现场结论：现场负责人对能否继续作业给出的判断 */
export type SiteConclusion = 'unset' | 'proceed' | 'suspend'

/** 复核结论：复核环节给出的判断，优先级高于现场结论 */
export type ReviewConclusion = 'unset' | 'pass' | 'rework' | 'question'

/** 三类阶段动作的统一键名，三个入口都只认这一份 */
export type GateKey = 'cleaning' | 'mapping' | 'dissection'

export type GateReasonCode =
  | 'stage-not-ready'
  | 'already-reached'
  | 'missing-opening-layer'
  | 'conclusion-pending'
  | 'site-suspended'
  | 'review-rework'
  | 'review-question'

export type GateReason = {
  code: GateReasonCode
  source: 'stage' | 'site' | 'review' | 'data'
}

/** 综合结论：复核结论优先于现场结论；冲突时仍以复核为准，同时标记 conflict */
export type ConclusionResolution =
  | { kind: 'allowed' }
  | { kind: 'blocked'; reason: GateReasonCode; source: 'site' | 'review' }
  | { kind: 'hold'; reason: 'review-question' }
  | { kind: 'pending' }

/** 单个阶段动作在某条遗迹、某个策略版本下的求值结果 */
export type GateEvaluation = {
  key: GateKey
  label: string
  targetStage: FeatureStage
  /** 目标阶段已经走完，动作不可再点 */
  reached: boolean
  /** 当前是否允许执行 */
  available: boolean
  /** 不允许时的全部原因（可能同时缺层位且结论冲突，统一给全） */
  reasons: GateReason[]
  policyId: string
  policyLabel: string
}

/** 关联档案（影像/图纸）的齐备度状态 */
export type PhotoReadinessState = 'missing' | 'pending-number' | 'needs-retake' | 'ready'
export type DrawingReadinessState =
  | 'missing'
  | 'drafting'
  | 'pending-review'
  | 'needs-rework'
  | 'ready'

export type FeatureRecord = {
  id: number
  /** 遗迹编号，如 FEAT-0001，影像/图纸靠它关联 */
  code: string
  trench: string
  kind: string
  /** 开口层位；旧数据缺失时回填占位文案并置 openingLayerBackfilled */
  openingLayer: string
  /** true = 该开口层位是旧数据回填的占位值，并非真实层位，仍需人工补录 */
  openingLayerBackfilled: boolean
  stage: FeatureStage
  /** 阶段最后变更时间（ISO 日期），决定按哪一版策略口径解释 */
  stageUpdatedAt: string
  siteConclusion: SiteConclusion
  reviewConclusion: ReviewConclusion
  /** 迁移自旧版数据：保留按历史口径解释的能力 */
  legacy: boolean
}

export type PhotoRecord = {
  id: number
  code: string
  /** 关联遗迹编号；空串或匹配不到遗迹 = 未关联（异常边界） */
  featureCode: string
  kind: string
  bearing: string
  shotAt: string
  operator: string
  status: '已拍摄' | '已编号' | '已归档' | '需重拍'
}

export type DrawingRecord = {
  id: number
  code: string
  featureCode: string
  kind: string
  scale: string
  drawer: string
  reviewer: string
  finishedAt: string
  status: '绘制中' | '待校核' | '已校核' | '已数字化' | '需修改'
}

/** 持久化结构，带 schema 版本，迁移只做一次 */
export type WorkspaceData = {
  schemaVersion: 1
  migratedAt: string
  features: FeatureRecord[]
  photos: PhotoRecord[]
  drawings: DrawingRecord[]
}

/** 遗迹列表行：策略引擎对一条遗迹的完整派生结果 */
export type FeatureView = {
  record: FeatureRecord
  stageLabel: string
  policyId: string
  policyLabel: string
  /** 是否按历史版本口径解释（历史遗迹保留原状态语义） */
  historical: boolean
  resolution: ConclusionResolution
  /** 现场结论与复核结论不一致；已按复核优先处理，但需显式暴露 */
  conflict: boolean
  gates: Record<GateKey, GateEvaluation>
  photos: {
    items: PhotoRecord[]
    state: PhotoReadinessState
    ready: boolean
  }
  drawings: {
    items: DrawingRecord[]
    state: DrawingReadinessState
    ready: boolean
  }
  abnormal: boolean
  abnormalReasons: string[]
  pending: boolean
}

export type WorkspaceSnapshot = {
  generatedAt: string
  features: FeatureView[]
  photos: PhotoRecord[]
  drawings: DrawingRecord[]
  unlinkedPhotos: PhotoRecord[]
  unlinkedDrawings: DrawingRecord[]
  stats: {
    featureTotal: number
    cleaning: number
    mapped: number
    abnormalFeatures: number
    photoTodo: number
    drawingTodo: number
  }
}

export type MutationSuccess<T> = T extends void
  ? { ok: true; message: string }
  : { ok: true; message: string; data: T }

export type MutationResult<T = void> =
  | MutationSuccess<T>
  | { ok: false; message: string; retryable: boolean }
