/* eslint-disable no-console */
/**
 * 遗迹工作区策略层校验脚本（node --import tsx 等价方式不可用时用 ts 转译运行）。
 * 覆盖需求点名的五条不变量：
 *  1. 历史遗迹按原状态（2025 历史口径）解释；
 *  2. 现场结论与复核结论冲突时复核优先；
 *  3. 缺开口层位的旧数据回填且标记待补；
 *  4. 遗迹列表 / 影像待办 / 绘图附件读同一份快照；
 *  5. 任一路径失败不写半份（可重试且旧状态保留）。
 */
import { createWorkspaceService } from '../src/data/workspace/service'
import { buildSnapshot } from '../src/data/workspace/snapshot'
import {
  MISSING_OPENING_LAYER_PLACEHOLDER,
  migrateLegacy,
} from '../src/data/workspace/migration'
import { policyForDate, resolveConclusion, evaluateAllGates } from '../src/data/workspace/policy'
import { createInitialWorkspace, loadWorkspace } from '../src/data/workspace/storage'
import type { EntryRow } from '../src/data/types'
import type { WorkspaceData } from '../src/data/workspace/types'

let failures = 0
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`)
  } else {
    failures += 1
    console.error(`  ✗ ${message}`)
  }
}

class MemoryBackend {
  store = new Map<string, string>()
  failing = false
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    if (this.failing) throw new Error('quota exceeded')
    this.store.set(key, value)
  }
}

/* 1. 版本化口径 + 历史遗迹原状态解释 */
console.log('策略版本')
assert(policyForDate('2025-09-12').id === 'policy-2025', '2025 年阶段变更走历史口径')
assert(policyForDate('2026-04-02').id === 'policy-2026', '2026 年阶段变更走现行口径')
assert(policyForDate('2024-01-01').id === 'policy-2025', '早于任一版本时兜底到最早口径')

const legacyFeature: WorkspaceData['features'][number] = {
  id: 99,
  code: 'FEAT-2025-099',
  trench: 'T0101',
  kind: '灰沟',
  openingLayer: '',
  openingLayerBackfilled: false,
  stage: 'cleaning',
  stageUpdatedAt: '2025-09-12',
  siteConclusion: 'unset',
  reviewConclusion: 'unset',
  legacy: true,
}
const legacyGates = evaluateAllGates(legacyFeature)
assert(
  legacyGates.mapping.available && legacyGates.dissection.available === false
    && legacyGates.mapping.reasons.length === 0,
  '历史遗迹：清理中可直接测绘，不因缺结论/层位被新口径卡住',
)
assert(
  legacyGates.dissection.available === false
    && legacyGates.dissection.reasons.some((r) => r.code === 'stage-not-ready'),
  '历史遗迹：未到解剖阶段仍受阶段顺序约束（原状态语义）',
)

/* 2. 现场 vs 复核优先级与冲突 */
console.log('结论优先级')
const conflicting: WorkspaceData['features'][number] = {
  ...legacyFeature,
  code: 'FEAT-2026-100',
  stage: 'cleaning',
  stageUpdatedAt: '2026-05-10',
  openingLayer: '第3层下',
  openingLayerBackfilled: false,
  legacy: false,
  siteConclusion: 'proceed',
  reviewConclusion: 'rework',
}
const conflictResult = resolveConclusion(conflicting)
assert(
  conflictResult.resolution.kind === 'blocked'
    && (conflictResult.resolution as { reason: string }).reason === 'review-rework',
  '现场同意但复核要求返工时，复核优先阻断',
)
assert(conflictResult.conflict === true, '冲突被显式标记')
const question = resolveConclusion({ ...conflicting, reviewConclusion: 'question' })
assert(question.resolution.kind === 'hold', '复核存疑时结论挂起')
const siteSuspend = resolveConclusion({ ...conflicting, reviewConclusion: 'unset', siteConclusion: 'suspend' })
assert(siteSuspend.resolution.kind === 'blocked', '无复核时现场暂缓仍然阻断')

/* 现行口径各动作 */
const modernGates = evaluateAllGates(conflicting)
assert(modernGates.mapping.available === false, '复核返工时测绘也被阻断')
assert(
  modernGates.mapping.reasons.some((r) => r.code === 'review-rework'),
  '阻断原因指明复核返工',
)
const noLayer = evaluateAllGates({ ...conflicting, stage: 'revealed', reviewConclusion: 'unset', siteConclusion: 'proceed', openingLayer: '', openingLayerBackfilled: true })
assert(
  !noLayer.cleaning.available
    && noLayer.cleaning.reasons.some((r) => r.code === 'missing-opening-layer'),
  '现行口径缺开口层位时清理被卡',
)
const proceedMapped = evaluateAllGates({
  ...conflicting,
  stage: 'mapped',
  siteConclusion: 'proceed',
  reviewConclusion: 'pass',
})
assert(proceedMapped.dissection.available, '层位齐备、双结论放行、已完绘时可解剖')
assert(proceedMapped.cleaning.reasons.some((r) => r.code === 'already-reached'), '已完成的动作不可重复执行')

/* 3. 旧数据迁移：缺开口层位回填、关联提取、未关联隔离 */
console.log('旧数据迁移')
const legacyTables = {
  feature: [
    { id: 1, status: '已揭露', pending: true, abnormal: false, 遗迹编号: 'FEAT-OLD-01', 所属探方: 'T1', 遗迹类型: '坑', 开口层位: '' },
    { id: 2, status: '清理中', pending: true, abnormal: false, 遗迹编号: 'FEAT-OLD-02', 所属探方: 'T1', 遗迹类型: '沟', 开口层位: '第2层' },
  ] as EntryRow[],
  photography: [
    { id: 1, status: '已拍摄', pending: true, abnormal: false, 影像编号: 'P1', 拍摄对象: '拍摄 FEAT-OLD-01 全景' },
    { id: 2, status: '已编号', pending: false, abnormal: false, 影像编号: 'P2', 拍摄对象: '没有提到遗迹编号' },
  ] as EntryRow[],
  drawing: [
    { id: 1, status: '待校核', pending: true, abnormal: false, 图纸编号: 'D1', 绘图对象: 'FEAT-OLD-02 平面图' },
  ] as EntryRow[],
}
const migrated = migrateLegacy(legacyTables, '2026-10-06')
assert(migrated.features.every((f) => f.legacy), '旧遗迹全部标记 legacy')
assert(
  migrated.features[0].openingLayer === MISSING_OPENING_LAYER_PLACEHOLDER
    && migrated.features[0].openingLayerBackfilled,
  '缺开口层位回填占位并标记 backfilled',
)
assert(migrated.features[1].openingLayer === '第2层' && !migrated.features[1].openingLayerBackfilled, '有层位的旧数据原样保留')
assert(migrated.photos[0].featureCode === 'FEAT-OLD-01', '影像按对象文本中的遗迹编号关联')
assert(migrated.photos[1].featureCode === '', '提取不到遗迹编号时不强行挂靠')
assert(migrated.drawings[0].featureCode === 'FEAT-OLD-02', '图纸按对象文本关联')
const migratedSnapshot = buildSnapshot(migrated)
assert(migratedSnapshot.unlinkedPhotos.length === 1, '未关联影像进入独立分组')
const backfilledView = migratedSnapshot.features[0]
assert(
  backfilledView.abnormal
    && backfilledView.abnormalReasons.some((r) => r.includes('开口层位缺失')),
  '回填层位在列表显式异常待补，但不影响其历史口径动作',
)

/* 4. 三处入口读同一份快照 */
console.log('三处同快照')
const backend = new MemoryBackend()
const service = createWorkspaceService(backend as never, () => '2026-10-06')
const before = service.snapshot()
const firstFeature = before.features.find((f) => f.record.code === 'FEAT-2026-004')
assert(firstFeature !== undefined && firstFeature.gates.dissection.available, 'F004 当前可解剖')
const result = service.advanceFeature(firstFeature!.record.id, 'dissection')
assert(result.ok, `推进解剖成功：${result.ok ? result.message : ''}`)
const after = service.snapshot()
const moved = after.features.find((f) => f.record.code === 'FEAT-2026-004')
assert(moved?.record.stage === 'dissected', '遗迹列表看到阶段已推进')
assert(
  after.generatedAt !== before.generatedAt || after !== before,
  '动作后整体重新生成快照（三处下次读取拿到同一结果）',
)
// 同一服务实例即三处页面共享的单例；遗迹、影像、图纸视图都从同一 snapshot 取数
assert(
  after.features.every((f) => f.photos.items.every((p) => after.photos.includes(p))),
  '影像待办用的照片与遗迹快照中的照片是同一批',
)
assert(
  after.features.every((f) => f.drawings.items.every((d) => after.drawings.includes(d))),
  '绘图附件用的图纸与遗迹快照中的图纸是同一批',
)

/* 阻断失败时状态不变 */
const blockedTarget = after.features.find((f) => f.record.code === 'FEAT-2026-001')
const blocked = service.advanceFeature(blockedTarget!.record.id, 'cleaning')
assert(!blocked.ok && blocked.message.includes('缺少开口层位'), `阻断给出统一原因：${blocked.ok ? '' : blocked.message}`)
const still = service.snapshot().features.find((f) => f.record.code === 'FEAT-2026-001')
assert(still?.record.stage === 'revealed', '阻断动作不改变任何状态')

/* 影像/图纸动作 */
const photo1 = after.photos.find((p) => p.code === 'PHOT-0101')
const pr = service.photoAction(photo1!.id, '分配编号')
assert(pr.ok && service.snapshot().photos.find((p) => p.id === photo1!.id)?.status === '已编号', '影像编号流转成功并反映到快照')
const badPhoto = service.photoAction(photo1!.id, '提交归档')
assert(badPhoto.ok, '已编号影像可归档')
const wrongPhoto = service.photoAction(photo1!.id, '分配编号')
assert(!wrongPhoto.ok, '重复/非法流转被拒')

/* 5. 持久化失败：可重试、缓存与存储都保持旧状态（不写一半） */
console.log('失败一致性')
const failBackend = new MemoryBackend()
const failService = createWorkspaceService(failBackend as never, () => '2026-10-06')
const preStage = failService.snapshot().features.find((f) => f.record.code === 'FEAT-2026-004')!.record.stage
failBackend.failing = true
const failed = failService.advanceFeature(
  failService.snapshot().features.find((f) => f.record.code === 'FEAT-2026-004')!.record.id,
  'dissection',
)
assert(failed.ok === false && failed.retryable, '写入失败返回可重试错误')
failBackend.failing = false
const recoveredStage = failService.snapshot().features.find((f) => f.record.code === 'FEAT-2026-004')!.record.stage
assert(recoveredStage === preStage, '失败后内存仍是旧状态，重试在同一状态上继续')
const retryOk = failService.advanceFeature(
  failService.snapshot().features.find((f) => f.record.code === 'FEAT-2026-004')!.record.id,
  'dissection',
)
assert(retryOk.ok, '存储恢复后重试成功，状态一次性推进')

/* 结论设置与冲突联动 */
console.log('结论联动')
const cr = service.setConclusion(
  service.snapshot().features.find((f) => f.record.code === 'FEAT-2026-003')!.record.id,
  'review',
  'pass',
)
assert(cr.ok, '复核结论可更新')
const f003 = service.snapshot().features.find((f) => f.record.code === 'FEAT-2026-003')
assert(f003?.record.reviewConclusion === 'pass', '新结论已生效')

/* 重置恢复演示数据 */
console.log('重置边界')
const resetResult = service.resetWorkspace()
assert(resetResult.ok && service.snapshot().stats.featureTotal === 6, '重置后回到完整演示数据，三处同步')

/* 浏览器首次加载：旧版散表 → 迁移；空用户 → 演示数据 */
console.log('首次加载边界')
class KVMap {
  store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}
const legacyBackend = new KVMap()
legacyBackend.setItem(
  'field-archaeology-digital:entries',
  JSON.stringify({
    feature: [
      { id: 1, status: '已揭露', pending: true, abnormal: false, 遗迹编号: 'FEAT-7', 所属探方: 'T1', 遗迹类型: '坑', 开口层位: '' },
    ],
    photography: [
      { id: 1, status: '已拍摄', pending: true, abnormal: false, 影像编号: 'P7', 拍摄对象: 'FEAT-7 全景' },
    ],
    drawing: [],
  }),
)
const initial = createInitialWorkspace(legacyBackend as never)
assert(
  initial.features[0].openingLayerBackfilled && initial.photos[0].featureCode === 'FEAT-7',
  '老用户首次进入：缺层位回填、影像按编号关联',
)
const loaded = loadWorkspace(legacyBackend as never)
assert(loaded.features.length === 1 && loaded.photos.length === 1, '首次加载后迁移结果完整落库并可再次读出')

const emptyBackend = new KVMap()
const seedInitial = createInitialWorkspace(emptyBackend as never)
assert(seedInitial.features.length === 6, '空用户首次进入得到完整演示数据')

const corruptBackend = new KVMap()
corruptBackend.setItem('field-archaeology-digital:feature-workspace:v1', '{不是合法JSON')
let corruptCaught = false
try {
  loadWorkspace(corruptBackend as never)
} catch (error) {
  corruptCaught = error instanceof Error && error.message.includes('无法解析')
}
assert(corruptCaught, '工作区数据损坏时抛出明确错误，交上层走重试/重置，不静默吞掉')

if (failures > 0) {
  console.error(`\n${failures} 项校验失败`)
  process.exit(1)
}
console.log('\n全部校验通过')
