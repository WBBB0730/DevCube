// 左树条目行的吸顶布局（纯函数，可单测）。

export interface TreeStickyInput {
  key: string
  pinned: boolean
  /** 常驻吸顶：滚过自身后钉住、不被下一段顶走（当前条目，及「固定运行中」开时有配置在运行的条目）。 */
  persist: boolean
}

export interface TreeStickyRow {
  /** 摊平常驻；「固定置顶」开时的置顶行已在叠放堆里，不再算常驻。 */
  persist: boolean
  /** 吸顶位置：排在它之前、已钉住的行数（固定置顶叠放行 + 常驻行）。 */
  slot: number
}

/**
 * 按左树可见序（置顶在前）给每个条目行定吸顶位置：钉住的行依次往下叠，
 * 其余行贴在排在它之前的那一叠下面、被下一段顶走；排在它之后的钉住行不影响它。
 */
export function treeStickyLayout(
  entries: readonly TreeStickyInput[],
  pinSticky: boolean
): Map<string, TreeStickyRow> {
  const rows = new Map<string, TreeStickyRow>()
  let stuck = 0
  for (const entry of entries) {
    const stacked = pinSticky && entry.pinned
    const persist = !stacked && entry.persist
    rows.set(entry.key, { persist, slot: stuck })
    if (stacked || persist) stuck += 1
  }
  return rows
}
