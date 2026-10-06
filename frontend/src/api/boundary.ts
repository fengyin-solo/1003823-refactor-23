/**
 * 统一边界：空态、缺失、异常、失败（可重试）在所有入口按同一套口径处理。
 * 服务层只返回这几种结果，页面不各自发明错误表示。
 */
export type Boundary<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'empty'; message: string }
  | { kind: 'missing'; message: string }
  | { kind: 'abnormal'; message: string }
  | { kind: 'failed'; message: string; retryable: boolean }

export type BoundaryKind = Boundary<never>['kind']

export const BOUNDARY_LABEL: Record<BoundaryKind, string> = {
  ok: '正常',
  empty: '空态',
  missing: '缺失',
  abnormal: '异常',
  failed: '失败',
}

export function ok<T>(value: T): Boundary<T> {
  return { kind: 'ok', value }
}

export function empty<T = never>(message: string): Boundary<T> {
  return { kind: 'empty', message }
}

export function missing<T = never>(message: string): Boundary<T> {
  return { kind: 'missing', message }
}

export function abnormal<T = never>(message: string): Boundary<T> {
  return { kind: 'abnormal', message }
}

export function failed<T = never>(message: string, retryable = true): Boundary<T> {
  return { kind: 'failed', message, retryable }
}
