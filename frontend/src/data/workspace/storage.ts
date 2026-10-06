import { buildSeedWorkspace } from './seed'
import { migrateLegacy, type LegacyTables } from './migration'
import type { WorkspaceData } from './types'

/**
 * 遗迹工作区存储层。
 *
 * 三条边界约定（需求点名）：
 * - 整个工作区只用一个 localStorage key，一次写入完整结构，任何一路失败都不会只写一半；
 * - 存储后端可注入：生产用 window.localStorage，测试用内存 Map；
 * - 读不到/已损坏/结构异常时不静默吞掉，抛 WorkspaceStorageError，由上层走「重试 / 重置」统一边界。
 */

export const WORKSPACE_STORAGE_KEY = 'field-archaeology-digital:feature-workspace:v1'

export class WorkspaceStorageError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'WorkspaceStorageError'
    this.retryable = retryable
  }
}

export interface KVBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 浏览器后端；SSR / 隐私模式下退化为内存，保证读取路径不崩 */
export function browserBackend(): KVBackend {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function assertShape(value: unknown): WorkspaceData {
  if (typeof value !== 'object' || value === null) {
    throw new WorkspaceStorageError('工作区数据结构损坏：根节点不是对象', false)
  }
  const data = value as Record<string, unknown>
  for (const field of ['features', 'photos', 'drawings']) {
    if (!Array.isArray(data[field])) {
      throw new WorkspaceStorageError(`工作区数据结构损坏：${field} 不是数组`, false)
    }
  }
  return value as WorkspaceData
}

/**
 * 读取工作区：旧用户首次进入时，把旧版散表迁移进来并完整落库；
 * 迁移与首次持久化必须一起成功，否则报错让上层重试，不返回没落库的半成品。
 */
export function loadWorkspace(backend: KVBackend = browserBackend()): WorkspaceData {
  const raw = backend.getItem(WORKSPACE_STORAGE_KEY)
  if (raw !== null) {
    try {
      return assertShape(JSON.parse(raw))
    } catch (error) {
      if (error instanceof WorkspaceStorageError) throw error
      throw new WorkspaceStorageError('工作区数据无法解析，可尝试重置为演示数据', false)
    }
  }

  const fresh = createInitialWorkspace(backend)
  persistWorkspace(fresh, backend)
  return fresh
}

/**
 * 决定初始工作区：
 * - 存在旧版散表（key 不带工作区后缀）→ 迁移旧数据，承担缺开口层位回填；
 * - 否则 → 内置演示数据。
 */
export function createInitialWorkspace(backend: KVBackend = browserBackend()): WorkspaceData {
  const legacyRaw = backend.getItem('field-archaeology-digital:entries')
  if (legacyRaw !== null) {
    try {
      const parsed = JSON.parse(legacyRaw) as Record<string, unknown>
      const tables: LegacyTables = {
        feature: Array.isArray(parsed.feature) ? (parsed.feature as never) : undefined,
        photography: Array.isArray(parsed.photography) ? (parsed.photography as never) : undefined,
        drawing: Array.isArray(parsed.drawing) ? (parsed.drawing as never) : undefined,
      }
      if (tables.feature && tables.feature.length > 0) {
        return migrateLegacy(tables, new Date().toISOString().slice(0, 10))
      }
    } catch {
      // 旧数据损坏不牵连新工作区：落到演示数据，旧表本身不改动
    }
  }
  return clone(buildSeedWorkspace())
}

/** 原子持久化：先序列化完整数据，再一次写入；写失败时内存缓存由调用方决定是否放弃 */
export function persistWorkspace(data: WorkspaceData, backend: KVBackend = browserBackend()): void {
  let serialized: string
  try {
    serialized = JSON.stringify(data)
  } catch {
    throw new WorkspaceStorageError('工作区数据序列化失败，未写入任何内容', false)
  }
  try {
    backend.setItem(WORKSPACE_STORAGE_KEY, serialized)
  } catch {
    throw new WorkspaceStorageError('工作区写入失败（可能是存储空间不足），可重试', true)
  }
}
