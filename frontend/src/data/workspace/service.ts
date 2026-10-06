import {
  WORKSPACE_STORAGE_KEY,
  WorkspaceStorageError,
  browserBackend,
  loadWorkspace,
  persistWorkspace,
  type KVBackend,
} from './storage'
import { buildSeedWorkspace } from './seed'
import { buildSnapshot, describeGateReasons } from './snapshot'
import { evaluateAllGates } from './policy'
import type {
  DrawingRecord,
  FeatureRecord,
  GateKey,
  MutationResult,
  PhotoRecord,
  ReviewConclusion,
  SiteConclusion,
  WorkspaceData,
  WorkspaceSnapshot,
} from './types'

/**
 * 遗迹工作区服务：三个入口（遗迹列表 / 影像待办 / 绘图附件）唯一的状态出口。
 *
 * 写一致性边界：
 * 每次变更都先在副本上构造「完整的下一版工作区」，再单次持久化；
 * 持久化失败则保留旧缓存、原样返回可重试错误 —— 任一路径失败都不会只写一半。
 */

export type WorkspaceService = ReturnType<typeof createWorkspaceService>

type Clock = () => string

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createWorkspaceService(
  backend: KVBackend = browserBackend(),
  clock: Clock = () => new Date().toISOString().slice(0, 10),
) {
  let cache: WorkspaceData | null = null

  function data(): WorkspaceData {
    if (cache === null) {
      cache = loadWorkspace(backend)
    }
    return cache
  }

  /** 失败重试入口：丢弃缓存重新读取/迁移 */
  function reload(): MutationResult<WorkspaceSnapshot> {
    cache = null
    try {
      cache = loadWorkspace(backend)
      return { ok: true, message: '工作区已重新加载', data: snapshot() }
    } catch (error) {
      cache = null
      const message = error instanceof Error ? error.message : '工作区读取失败'
      return { ok: false, message, retryable: error instanceof WorkspaceStorageError }
    }
  }

  function snapshot(): WorkspaceSnapshot {
    return buildSnapshot(data())
  }

  /** 统一提交：序列化 + 单次写入成功后才替换缓存 */
  function commit(next: WorkspaceData, message: string): MutationResult {
    try {
      persistWorkspace(next, backend)
    } catch (error) {
      const retryable = error instanceof WorkspaceStorageError ? error.retryable : false
      const text = error instanceof Error ? error.message : '工作区写入失败'
      return { ok: false, message: `${text}；本次改动未落库，可重试`, retryable }
    }
    cache = next
    return { ok: true, message }
  }

  function findFeature(rows: FeatureRecord[], id: number): FeatureRecord | undefined {
    return rows.find((r) => r.id === id)
  }

  function advanceFeature(id: number, gate: GateKey): MutationResult {
    const current = data()
    const record = findFeature(current.features, id)
    if (!record) {
      return { ok: false, message: `没有找到编号为 ${id} 的遗迹`, retryable: false }
    }
    const evaluation = evaluateAllGates(record)[gate]
    if (!evaluation.available) {
      return {
        ok: false,
        message: `遗迹 ${record.code} 现在不能「${evaluation.label}」：${describeGateReasons(
          evaluation.reasons,
        )}（${evaluation.policyLabel}）`,
        retryable: false,
      }
    }

    const next = clone(current)
    const target = findFeature(next.features, id)
    if (!target) {
      return { ok: false, message: '遗迹在提交过程中丢失，请重试', retryable: true }
    }
    target.stage = evaluation.targetStage
    target.stageUpdatedAt = clock()
    return commit(next, `遗迹 ${record.code} 已${evaluation.label}，当前进入「${evaluation.targetStage === 'cleaning' ? '清理中' : evaluation.targetStage === 'mapped' ? '已完绘' : '已解剖'}」`)
  }

  function setConclusion(
    id: number,
    kind: 'site' | 'review',
    value: SiteConclusion | ReviewConclusion,
  ): MutationResult {
    const current = data()
    if (!findFeature(current.features, id)) {
      return { ok: false, message: `没有找到编号为 ${id} 的遗迹`, retryable: false }
    }
    const next = clone(current)
    const target = findFeature(next.features, id)
    if (!target) {
      return { ok: false, message: '遗迹在提交过程中丢失，请重试', retryable: true }
    }
    if (kind === 'site') target.siteConclusion = value as SiteConclusion
    else target.reviewConclusion = value as ReviewConclusion
    const label = kind === 'site' ? '现场结论' : '复核结论'
    return commit(next, `遗迹 ${target.code} 的${label}已更新，口径已重新评估`)
  }

  const PHOTO_TRANSITIONS: Record<string, { from: PhotoRecord['status'][]; to: PhotoRecord['status']; label: string }> = {
    分配编号: { from: ['已拍摄'], to: '已编号', label: '分配编号' },
    提交归档: { from: ['已编号'], to: '已归档', label: '提交归档' },
    安排重拍: { from: ['已拍摄', '已编号', '已归档'], to: '需重拍', label: '安排重拍' },
  }

  function photoAction(id: number, action: string): MutationResult {
    const rule = PHOTO_TRANSITIONS[action]
    if (!rule) {
      return { ok: false, message: `影像没有登记「${action}」这个动作`, retryable: false }
    }
    const current = data()
    const record = current.photos.find((r) => r.id === id)
    if (!record) {
      return { ok: false, message: `没有找到编号为 ${id} 的影像档案`, retryable: false }
    }
    if (record.status === rule.to) {
      return { ok: false, message: `影像 ${record.code} 已经是「${rule.to}」，不用重复操作`, retryable: false }
    }
    if (!rule.from.includes(record.status)) {
      return {
        ok: false,
        message: `影像 ${record.code} 当前「${record.status}」，不能「${rule.label}」`,
        retryable: false,
      }
    }
    const next = clone(current)
    const target = next.photos.find((r) => r.id === id)
    if (!target) {
      return { ok: false, message: '影像在提交过程中丢失，请重试', retryable: true }
    }
    target.status = rule.to
    return commit(next, `影像 ${target.code} 已${rule.label}，当前状态「${rule.to}」`)
  }

  const DRAWING_TRANSITIONS: Record<string, { from: DrawingRecord['status'][]; to: DrawingRecord['status']; label: string }> = {
    提交校核: { from: ['绘制中', '需修改'], to: '待校核', label: '提交校核' },
    确认校核: { from: ['待校核'], to: '已校核', label: '确认校核' },
    退回修改: { from: ['待校核'], to: '需修改', label: '退回修改' },
  }

  function drawingAction(id: number, action: string): MutationResult {
    const rule = DRAWING_TRANSITIONS[action]
    if (!rule) {
      return { ok: false, message: `图纸没有登记「${action}」这个动作`, retryable: false }
    }
    const current = data()
    const record = current.drawings.find((r) => r.id === id)
    if (!record) {
      return { ok: false, message: `没有找到编号为 ${id} 的实测图纸`, retryable: false }
    }
    if (record.status === rule.to) {
      return { ok: false, message: `图纸 ${record.code} 已经是「${rule.to}」，不用重复操作`, retryable: false }
    }
    if (!rule.from.includes(record.status)) {
      return {
        ok: false,
        message: `图纸 ${record.code} 当前「${record.status}」，不能「${rule.label}」`,
        retryable: false,
      }
    }
    const next = clone(current)
    const target = next.drawings.find((r) => r.id === id)
    if (!target) {
      return { ok: false, message: '图纸在提交过程中丢失，请重试', retryable: true }
    }
    target.status = rule.to
    return commit(next, `图纸 ${target.code} 已${rule.label}，当前状态「${rule.to}」`)
  }

  function resetWorkspace(): MutationResult<WorkspaceSnapshot> {
    const seed = clone(buildSeedWorkspace())
    const result = commit(seed, '工作区已重置为演示数据，三处入口已同步')
    if (result.ok === false) return { ok: false, message: result.message, retryable: result.retryable }
    return { ok: true, message: result.message, data: snapshot() }
  }

  return {
    storageKey: WORKSPACE_STORAGE_KEY,
    snapshot,
    reload,
    resetWorkspace,
    advanceFeature,
    setConclusion,
    photoAction,
    drawingAction,
  }
}

/** 进程内单例：三个页面共享同一份缓存与同一份快照 */
let singleton: WorkspaceService | null = null

export function workspaceService(): WorkspaceService {
  if (!singleton) {
    singleton = createWorkspaceService()
  }
  return singleton
}
