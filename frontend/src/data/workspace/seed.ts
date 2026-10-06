import type { WorkspaceData } from './types'

/**
 * 遗迹工作区演示数据。刻意覆盖需求点名的各类边界：
 * - F01 现行口径下缺开口层位（旧数据回填占位，仍异常待补）
 * - F02 现场同意、复核要求返工冲突（复核优先）
 * - F03 现场暂缓（影像已齐、图纸待校核，可测历史动作差异）
 * - F04 一切齐备，走完测绘前
 * - F05 复核存疑，图纸需修改
 * - F06 2025 老遗迹，按历史口径解释：即便缺结论/层位也不动其原阶段语义
 * - 另有未关联遗迹的影像与图纸（异常边界，独立分组不强行挂靠）
 */
export function buildSeedWorkspace(): WorkspaceData {
  return {
    schemaVersion: 1,
    migratedAt: '2026-10-06',
    features: [
      {
        id: 1,
        code: 'FEAT-2026-001',
        trench: 'T0302',
        kind: '灰坑',
        openingLayer: '',
        openingLayerBackfilled: true,
        stage: 'revealed',
        stageUpdatedAt: '2026-04-02',
        siteConclusion: 'proceed',
        reviewConclusion: 'unset',
        legacy: false,
      },
      {
        id: 2,
        code: 'FEAT-2026-002',
        trench: 'T0302',
        kind: '墓葬',
        openingLayer: '第3层下',
        openingLayerBackfilled: false,
        stage: 'cleaning',
        stageUpdatedAt: '2026-05-10',
        siteConclusion: 'proceed',
        reviewConclusion: 'rework',
        legacy: false,
      },
      {
        id: 3,
        code: 'FEAT-2026-003',
        trench: 'T0401',
        kind: '房址',
        openingLayer: '第2层下',
        openingLayerBackfilled: false,
        stage: 'cleaning',
        stageUpdatedAt: '2026-03-18',
        siteConclusion: 'suspend',
        reviewConclusion: 'unset',
        legacy: false,
      },
      {
        id: 4,
        code: 'FEAT-2026-004',
        trench: 'T0401',
        kind: '窑址',
        openingLayer: '第4层下',
        openingLayerBackfilled: false,
        stage: 'mapped',
        stageUpdatedAt: '2026-07-21',
        siteConclusion: 'proceed',
        reviewConclusion: 'pass',
        legacy: false,
      },
      {
        id: 5,
        code: 'FEAT-2026-005',
        trench: 'T0502',
        kind: '沟',
        openingLayer: '第3层下',
        openingLayerBackfilled: false,
        stage: 'mapped',
        stageUpdatedAt: '2026-08-09',
        siteConclusion: 'proceed',
        reviewConclusion: 'question',
        legacy: false,
      },
      {
        id: 6,
        code: 'FEAT-2025-018',
        trench: 'T0101',
        kind: '灰沟',
        openingLayer: '',
        openingLayerBackfilled: false,
        stage: 'cleaning',
        stageUpdatedAt: '2025-09-12',
        siteConclusion: 'unset',
        reviewConclusion: 'unset',
        legacy: true,
      },
    ],
    photos: [
      { id: 1, code: 'PHOT-0101', featureCode: 'FEAT-2026-001', kind: '全景', bearing: '正北', shotAt: '2026-04-02', operator: '周南', status: '已拍摄' },
      { id: 2, code: 'PHOT-0102', featureCode: 'FEAT-2026-002', kind: '近景', bearing: '正东', shotAt: '2026-05-08', operator: '周南', status: '需重拍' },
      { id: 3, code: 'PHOT-0103', featureCode: 'FEAT-2026-003', kind: '工作照', bearing: '正南', shotAt: '2026-03-17', operator: '林一', status: '已归档' },
      { id: 4, code: 'PHOT-0104', featureCode: 'FEAT-2026-003', kind: '近景', bearing: '正西', shotAt: '2026-03-17', operator: '林一', status: '已编号' },
      { id: 5, code: 'PHOT-0105', featureCode: 'FEAT-2026-004', kind: '剖面', bearing: '正北', shotAt: '2026-07-20', operator: '林一', status: '已归档' },
      { id: 6, code: 'PHOT-0106', featureCode: 'FEAT-2026-005', kind: '近景', bearing: '东南', shotAt: '2026-08-08', operator: '周南', status: '已编号' },
      { id: 7, code: 'PHOT-0107', featureCode: 'FEAT-2025-018', kind: '全景', bearing: '正北', shotAt: '2025-09-12', operator: '高远', status: '已归档' },
      { id: 8, code: 'PHOT-0108', featureCode: '', kind: '特写', bearing: '—', shotAt: '2026-09-28', operator: '林一', status: '已拍摄' },
    ],
    drawings: [
      { id: 1, code: 'DRAW-0201', featureCode: 'FEAT-2026-002', kind: '平面图', scale: '1:20', drawer: '苏绘', reviewer: '', finishedAt: '2026-05-12', status: '绘制中' },
      { id: 2, code: 'DRAW-0202', featureCode: 'FEAT-2026-003', kind: '剖面图', scale: '1:20', drawer: '苏绘', reviewer: '马校', finishedAt: '2026-03-20', status: '待校核' },
      { id: 3, code: 'DRAW-0203', featureCode: 'FEAT-2026-004', kind: '平面图', scale: '1:20', drawer: '苏绘', reviewer: '马校', finishedAt: '2026-07-19', status: '已数字化' },
      { id: 4, code: 'DRAW-0204', featureCode: 'FEAT-2026-005', kind: '剖面图', scale: '1:10', drawer: '苏绘', reviewer: '马校', finishedAt: '2026-08-10', status: '需修改' },
      { id: 5, code: 'DRAW-0205', featureCode: '', kind: '平面图', scale: '1:50', drawer: '苏绘', reviewer: '', finishedAt: '2026-09-30', status: '绘制中' },
    ],
  }
}
