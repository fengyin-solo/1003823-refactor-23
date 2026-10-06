import {
  DRAWING_STATE_TEXT,
  PHOTO_STATE_TEXT,
  STAGE_LABEL,
  drawingReadiness,
  evaluateAllGates,
  gateReasonText,
  photoReadiness,
  policyForDate,
  resolveConclusion,
} from './policy'
import type {
  FeatureView,
  GateReason,
  PhotoRecord,
  DrawingRecord,
  WorkspaceData,
  WorkspaceSnapshot,
} from './types'

/**
 * 快照求值：从「只存事实」的工作区数据，派生出三个入口共用的只读结果。
 * 任何写操作成功后都重新生成一次快照，遗迹列表 / 影像待办 / 绘图附件拿到的是同一份。
 */

function abnormalReasons(
  view: {
    record: WorkspaceData['features'][number]
    conflict: boolean
    photosReady: boolean
    photosState: string
    drawingsReady: boolean
    drawingsState: string
  },
): string[] {
  const out: string[] = []
  const { record } = view
  if (record.openingLayerBackfilled) {
    out.push('开口层位缺失（旧数据已回填占位，需人工补录）')
  }
  if (view.conflict) {
    out.push('现场结论与复核结论冲突，已按「复核优先」处理，请复核现场记录')
  }
  const resolution = resolveConclusion(record).resolution
  if (resolution.kind === 'blocked') {
    out.push(`结论阻断：${gateReasonText(resolution.reason)}`)
  } else if (resolution.kind === 'hold') {
    out.push(`结论挂起：${gateReasonText(resolution.reason)}`)
  }
  if (!view.photosReady) {
    out.push(`影像不齐：${PHOTO_STATE_TEXT[view.photosState as keyof typeof PHOTO_STATE_TEXT]}`)
  }
  if (!view.drawingsReady) {
    out.push(`图纸不齐：${DRAWING_STATE_TEXT[view.drawingsState as keyof typeof DRAWING_STATE_TEXT]}`)
  }
  return out
}

/** 一条遗迹是否仍有待办（未到已归档即算在途） */
function isPending(stage: WorkspaceData['features'][number]['stage']): boolean {
  return stage !== 'archived'
}

export function buildFeatureView(
  record: WorkspaceData['features'][number],
  photos: PhotoRecord[],
  drawings: DrawingRecord[],
): FeatureView {
  const policy = policyForDate(record.stageUpdatedAt)
  const { resolution, conflict } = resolveConclusion(record)
  const photo = photoReadiness(photos)
  const drawing = drawingReadiness(drawings)
  const gates = evaluateAllGates(record)

  const base = {
    record,
    conflict,
    photosReady: photo.ready,
    photosState: photo.state,
    drawingsReady: drawing.ready,
    drawingsState: drawing.state,
  }
  const reasons = abnormalReasons(base)

  return {
    record,
    stageLabel: STAGE_LABEL[record.stage],
    policyId: policy.id,
    policyLabel: policy.label,
    historical: record.legacy,
    resolution,
    conflict,
    gates,
    photos: { items: photos, state: photo.state, ready: photo.ready },
    drawings: { items: drawings, state: drawing.state, ready: drawing.ready },
    abnormal: reasons.length > 0,
    abnormalReasons: reasons,
    pending: isPending(record.stage),
  }
}

export function buildSnapshot(data: WorkspaceData): WorkspaceSnapshot {
  const codeSet = new Set(data.features.map((f) => f.code))
  const photosByFeature = new Map<string, PhotoRecord[]>()
  const drawingsByFeature = new Map<string, DrawingRecord[]>()

  for (const photo of data.photos) {
    const list = photosByFeature.get(photo.featureCode)
    if (list) list.push(photo)
    else photosByFeature.set(photo.featureCode, [photo])
  }
  for (const drawing of data.drawings) {
    const list = drawingsByFeature.get(drawing.featureCode)
    if (list) list.push(drawing)
    else drawingsByFeature.set(drawing.featureCode, [drawing])
  }

  const features = data.features.map((record) =>
    buildFeatureView(
      record,
      photosByFeature.get(record.code) ?? [],
      drawingsByFeature.get(record.code) ?? [],
    ),
  )

  const unlinkedPhotos = data.photos.filter((p) => !p.featureCode || !codeSet.has(p.featureCode))
  const unlinkedDrawings = data.drawings.filter((d) => !d.featureCode || !codeSet.has(d.featureCode))

  return {
    generatedAt: new Date().toISOString(),
    features,
    photos: data.photos,
    drawings: data.drawings,
    unlinkedPhotos,
    unlinkedDrawings,
    stats: {
      featureTotal: features.length,
      cleaning: features.filter((f) => f.record.stage === 'cleaning').length,
      mapped: features.filter((f) => f.record.stage === 'mapped').length,
      abnormalFeatures: features.filter((f) => f.abnormal).length,
      photoTodo: features.filter((f) => !f.photos.ready).length,
      drawingTodo: features.filter((f) => !f.drawings.ready).length,
    },
  }
}

export function describeGateReasons(reasons: GateReason[]): string {
  return reasons.map((r) => gateReasonText(r.code)).join('；')
}
