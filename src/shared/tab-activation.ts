import type { SessionStatus } from './types'

export interface TabActivationInput {
  /** 常驻 Git Tab；Server 条目没有（null） */
  gitKey: string | null
  /** 常驻 Files Tab；Server 条目没有（null） */
  filesKey: string | null
  runTabs: { key: string; status: SessionStatus }[]
  termTabs: { key: string }[]
  /** undefined = 从未显式激活；null / 失效键走默认规则 */
  stored: string | null | undefined
}

/** Tab 栏从左到右的键序：Git → Files → 运行会话 → 终端（缺席的常驻 Tab 跳过）。 */
export function orderedTabKeysOf(input: Omit<TabActivationInput, 'stored'>): string[] {
  return [
    ...(input.gitKey === null ? [] : [input.gitKey]),
    ...(input.filesKey === null ? [] : [input.filesKey]),
    ...input.runTabs.map((t) => t.key),
    ...input.termTabs.map((t) => t.key)
  ]
}

/**
 * 默认激活（ADR-0005）：有运行中的 Run Session → Tab 序第一个运行中的；
 * 否则按 Tab 序取第一个（Project 即 gitKey）；一个 Tab 都没有（空的 Server 条目）为 null。
 * 关闭邻接不走此函数。
 */
export function resolveDefaultActiveKey(input: Omit<TabActivationInput, 'stored'>): string | null {
  const running = input.runTabs.find((t) => t.status === 'running')
  if (running) return running.key
  return orderedTabKeysOf(input)[0] ?? null
}

/** 解析当前应激活的 Tab 键；null 表示没有任何 Tab（显示占位）。 */
export function resolveActiveTabKey(input: TabActivationInput): string | null {
  const { stored, ...tabs } = input
  if (stored !== undefined && stored !== null && orderedTabKeysOf(tabs).includes(stored)) {
    return stored
  }
  return resolveDefaultActiveKey(tabs)
}

/** 关闭某 Tab 后的邻接回落：左邻，其次右邻。 */
export function resolveNeighborAfterClose(orderedKeys: string[], closedKey: string): string | null {
  const idx = orderedKeys.indexOf(closedKey)
  const rest = orderedKeys.filter((k) => k !== closedKey)
  if (rest.length === 0) return null
  if (idx < 0) return rest[0]!
  return rest[idx - 1] ?? rest[idx] ?? null
}
