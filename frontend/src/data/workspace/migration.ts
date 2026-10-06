import type { EntryRow } from '../types'
import type {
  DrawingRecord,
  FeatureRecord,
  FeatureStage,
  PhotoRecord,
  WorkspaceData,
} from './types'

/**
 * 旧数据迁移：把散在三个通用模块里的 EntryRow 合并成遗迹工作区。
 *
 * 必须兜住的历史包袱（需求点名）：
 * 1. 旧遗迹一律 legacy=true，阶段时间落在旧口径生效期内，按原状态语义解释；
 * 2. 缺开口层位的旧数据回填占位文案并标记 backfilled，不阻断历史动作，但在列表里显式异常待补；
 * 3. 影像/图纸按对象字段里出现的遗迹编号关联，提取不到的不强行挂靠，归入「未关联」。
 * 迁移是纯函数且只执行一次，便于单测与重放。
 */

/** 缺开口层位时的回填占位值：一眼能看出是补的，不能当成真实层位 */
export const MISSING_OPENING_LAYER_PLACEHOLDER = '【旧数据缺开口层位·待补录】'

/** 旧数据没有阶段时间，统一落在 2025 历史口径生效期内，保证按原状态解释 */
export const LEGACY_STAGE_DATE = '2025-06-01'

const FEATURE_STAGE_MAP: Record<string, FeatureStage> = {
  已揭露: 'revealed',
  清理中: 'cleaning',
  已完绘: 'mapped',
  已解剖: 'dissected',
  已归档: 'archived',
}

const PHOTO_STATUS = ['已拍摄', '已编号', '已归档', '需重拍'] as const
const DRAWING_STATUS = ['绘制中', '待校核', '已校核', '已数字化', '需修改'] as const

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function normalizeFeatureCode(raw: string, id: number): string {
  const code = raw.trim()
  return code !== '' ? code : `LEGACY-FEAT-${String(id).padStart(4, '0')}`
}

export function migrateFeatures(rows: EntryRow[]): FeatureRecord[] {
  return rows.map((row) => {
    const id = Number(row.id)
    const rawLayer = text(row['开口层位'])
    const missingLayer = rawLayer === ''
    return {
      id,
      code: normalizeFeatureCode(text(row['遗迹编号']), id),
      trench: text(row['所属探方']),
      kind: text(row['遗迹类型']),
      openingLayer: missingLayer ? MISSING_OPENING_LAYER_PLACEHOLDER : rawLayer,
      openingLayerBackfilled: missingLayer,
      stage: FEATURE_STAGE_MAP[text(row['status'])] ?? 'revealed',
      stageUpdatedAt: LEGACY_STAGE_DATE,
      siteConclusion: 'unset',
      reviewConclusion: 'unset',
      legacy: true,
    }
  })
}

/** 在一段自由文本（拍摄对象/绘图对象）里找已知遗迹编号，找不到返回空串 */
function linkToFeature(objectText: string, codes: string[]): string {
  const hit = codes.find((code) => objectText.includes(code))
  return hit ?? ''
}

export function migratePhotos(rows: EntryRow[], featureCodes: string[]): PhotoRecord[] {
  return rows.map((row) => {
    const status = text(row['status'])
    return {
      id: Number(row.id),
      code: text(row['影像编号']) || `LEGACY-PHOT-${String(row.id).padStart(4, '0')}`,
      featureCode: linkToFeature(text(row['拍摄对象']), featureCodes),
      kind: text(row['拍摄类型']),
      bearing: text(row['拍摄方位']),
      shotAt: text(row['拍摄日期']),
      operator: text(row['摄影人员']),
      status: (PHOTO_STATUS as readonly string[]).includes(status)
        ? (status as PhotoRecord['status'])
        : '已拍摄',
    }
  })
}

export function migrateDrawings(rows: EntryRow[], featureCodes: string[]): DrawingRecord[] {
  return rows.map((row) => {
    const status = text(row['status'])
    return {
      id: Number(row.id),
      code: text(row['图纸编号']) || `LEGACY-DRAW-${String(row.id).padStart(4, '0')}`,
      featureCode: linkToFeature(text(row['绘图对象']), featureCodes),
      kind: text(row['绘图类型']),
      scale: text(row['比例尺']),
      drawer: text(row['绘图人']),
      reviewer: text(row['校核人']),
      finishedAt: text(row['完成日期']),
      status: (DRAWING_STATUS as readonly string[]).includes(status)
        ? (status as DrawingRecord['status'])
        : '绘制中',
    }
  })
}

export type LegacyTables = {
  feature?: EntryRow[]
  photography?: EntryRow[]
  drawing?: EntryRow[]
}

export function migrateLegacy(tables: LegacyTables, todayIso: string): WorkspaceData {
  const features = migrateFeatures(tables.feature ?? [])
  const codes = features.map((f) => f.code)
  return {
    schemaVersion: 1,
    migratedAt: todayIso,
    features,
    photos: migratePhotos(tables.photography ?? [], codes),
    drawings: migrateDrawings(tables.drawing ?? [], codes),
  }
}
