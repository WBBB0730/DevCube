import type { SessionStatus } from './types'

export interface TabActivationInput {
  /** 常驻非会话 Tab 的键，按 Tab 序：Project 为 Git、Files；Server 为 Status */
  residentKeys: string[]
  runTabs: { key: string; status: SessionStatus }[]
  termTabs: { key: string }[]
  /** undefined = 从未显式激活；null / 失效键走默认规则 */
  stored: string | null | undefined
}

/** Tab 栏从左到右的键序：常驻 Tab → 运行会话 → 终端。 */
export function orderedTabKeysOf(input: Omit<TabActivationInput, 'stored'>): string[] {
  return [
    ...input.residentKeys,
    ...input.runTabs.map((t) => t.key),
    ...input.termTabs.map((t) => t.key)
  ]
}

/**
 * 默认激活（ADR-0005）：有运行中的 Run Session → Tab 序第一个运行中的；
 * 否则按 Tab 序取第一个（Project 即 Git Tab，Server 即 Status Tab）；一个 Tab 都没有时为 null。
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
