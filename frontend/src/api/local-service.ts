import { empty, failed, ok, type Boundary } from '@/api/boundary'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows, storeVersion } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  assessFeature,
  drawingGate,
  featureActionStage,
  migrateFeatureRows,
  type FeatureWorkabilitySnapshot,
} from '@/domain/feature-workability'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// —— 遗迹阶段判定：全系统只有这一份，遗迹列表、影像待办、绘图附件都从这里读 ——

let migratedVersion = -1
let snapshotCache: { version: number; snapshot: FeatureWorkabilitySnapshot } | null = null

// 旧数据回填（口径版本、开口层位）：先算好整份结果再一次性提交，
// 任何一行处理失败都不会落盘，下次调用自动重试，不会写出半新半旧的数据。
function ensureFeatureMigration(): void {
  if (migratedVersion === storeVersion()) {
    return
  }
  const migration = migrateFeatureRows(listRows('feature'), listRows('trench'))
  if (migration.changed) {
    saveRows('feature', migration.rows)
  }
  migratedVersion = storeVersion()
}

export function loadFeatureWorkability(): Boundary<FeatureWorkabilitySnapshot> {
  try {
    ensureFeatureMigration()
    if (snapshotCache && snapshotCache.version === storeVersion()) {
      return ok(snapshotCache.snapshot)
    }
    const items = listRows('feature').map(assessFeature)
    const snapshot: FeatureWorkabilitySnapshot = {
      items,
      byId: new Map(items.map((item) => [item.id, item])),
      byCode: new Map(items.filter((item) => item.code !== '').map((item) => [item.code, item])),
      backfilledCount: items.filter((item) => item.openingStratumBackfilled).length,
      abnormalCount: items.filter((item) => item.phase === 'unknown').length,
    }
    snapshotCache = { version: storeVersion(), snapshot }
    if (items.length === 0) {
      return empty('暂无遗迹单位数据，阶段判定为空')
    }
    return ok(snapshot)
  } catch (error) {
    return failed(`遗迹阶段判定加载失败：${error instanceof Error ? error.message : '未知错误'}`, true)
  }
}

// 阶段守卫：遗迹动作与绘图提交校核都过同一份判定，返回 null 表示放行。
function guardStageAction(key: string, row: EntryRow, action: string): string | null {
  if (key === 'feature') {
    const stage = featureActionStage(action)
    if (!stage) {
      return null
    }
    const eligibility = assessFeature(row).stages[stage]
    return eligibility.allowed ? null : eligibility.reason
  }
  if (key === 'drawing' && action === '提交校核') {
    const result = loadFeatureWorkability()
    if (result.kind === 'failed') {
      return `${result.message}，请重试`
    }
    const gate = drawingGate(row, result.kind === 'ok' ? result.value.byCode : new Map())
    return gate.allowed ? null : gate.reason
  }
  return null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  let blocked: string | null
  try {
    blocked = guardStageAction(key, rows[index], action)
  } catch (error) {
    return { ok: false, message: `阶段判定失败：${error instanceof Error ? error.message : '未知错误'}，数据未变更，请重试` }
  }
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  try {
    saveRows(key, next)
  } catch (error) {
    // 落盘失败：内存与存储都保持原样，调用方可以安全重试
    return { ok: false, message: `${meta.entity}${action}写入失败，数据未变更，请重试` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
