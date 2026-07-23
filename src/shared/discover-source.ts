/** Discovered Script / 引用型配置的来源标识（ADR-0020）。 */
export type DiscoverSource = 'scripts' | 'go' | 'cargo' | 'flutter' | 'dotnet' | 'compose'

export const SCRIPT_SOURCE: DiscoverSource = 'scripts'

/** 候补菜单小标题（未命中的来源不渲染空组）。 */
export const DISCOVER_SOURCE_LABELS: Record<DiscoverSource, string> = {
  scripts: 'Node.js',
  go: 'Go',
  cargo: 'Cargo',
  flutter: 'Flutter',
  dotnet: '.NET',
  compose: 'Compose'
}

/** 菜单分组顺序。 */
export const DISCOVER_SOURCE_ORDER: readonly DiscoverSource[] = [
  'scripts',
  'go',
  'cargo',
  'flutter',
  'dotnet',
  'compose'
]
