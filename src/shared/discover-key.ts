import type { DiscoverSource } from './discover-source'

/** 来源与名的拼接分隔符（与 runnable scriptKey 段分隔一致，用 NUL）。 */
export const DISCOVER_KEY_SEP = String.fromCharCode(0)

/** 对账 / 晋升去重用的引用键：`source + NUL + name`。 */
export function discoverRefKey(source: DiscoverSource, name: string): string {
  return `${source}${DISCOVER_KEY_SEP}${name}`
}
