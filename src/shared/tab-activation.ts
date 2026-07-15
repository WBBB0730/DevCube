import type { SessionStatus } from './types'

export interface TabActivationInput {
  gitKey: string
  filesKey: string
  runTabs: { key: string; status: SessionStatus }[]
  termTabs: { key: string }[]
  /** undefined = 从未显式激活；null / 失效键走默认规则 */
  stored: string | null | undefined
}

/**
 * 默认激活（ADR-0005）：有运行中的 Run Session → Tab 序第一个运行中的；
 * 否则按 Tab 序（Git → Files → …）取第一个，即 gitKey。
 * 关闭邻接不走此函数。
 */
export function resolveDefaultActiveKey(input: Omit<TabActivationInput, 'stored'>): string {
  const running = input.runTabs.find((t) => t.status === 'running')
  if (running) return running.key
  return input.gitKey
}

/** 解析当前应激活的 Tab 键。 */
export function resolveActiveTabKey(input: TabActivationInput): string {
  const { gitKey, filesKey, runTabs, termTabs, stored } = input
  const valid = new Set<string>([
    gitKey,
    filesKey,
    ...runTabs.map((t) => t.key),
    ...termTabs.map((t) => t.key)
  ])
  if (stored !== undefined && stored !== null && valid.has(stored)) return stored
  return resolveDefaultActiveKey({ gitKey, filesKey, runTabs, termTabs })
}

/** 关闭某 Tab 后的邻接回落：左邻，其次右邻。 */
export function resolveNeighborAfterClose(orderedKeys: string[], closedKey: string): string | null {
  const idx = orderedKeys.indexOf(closedKey)
  const rest = orderedKeys.filter((k) => k !== closedKey)
  if (rest.length === 0) return null
  if (idx < 0) return rest[0]!
  return rest[idx - 1] ?? rest[idx] ?? null
}
