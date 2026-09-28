import type { DiscoverSource } from './discover-source'
import type { RunConfig } from './types'

// 「配置唯一键」：同一 script/config 单实例的依据（探测脚本与晋升后的引用型配置共享）。
// 引用型配置与同源同名探测脚本共享同一 key —— 保证探测脚本晋升为引用型配置后，会话连续、不重开。
// 分隔符用 NUL：路径 / 来源 / script 名都不可能包含它。
// 形状：projectPath \0 source \0 name（ADR-0020）。
const SEP = String.fromCharCode(0)

export function scriptKey(projectPath: string, source: DiscoverSource, scriptName: string): string {
  return `${projectPath}${SEP}${source}${SEP}${scriptName}`
}

export function configKey(config: RunConfig): string {
  return config.kind === 'referenced'
    ? scriptKey(config.projectPath, config.source, config.scriptName)
    : `cmd${SEP}${config.id}`
}

// Git Tab 键：每项目一个常驻、非会话的 Tab（ADR-0005），与会话键共用同一套激活/循环逻辑。
// 前缀 'git:' 不会与会话键撞车（script 键含 NUL、命令键 'cmd\0'、终端键 'terminal:<uuid>'）。
export function gitTabKey(projectPath: string): string {
  return `git:${projectPath}`
}

export function isGitTabKey(key: string): boolean {
  return key.startsWith('git:')
}

// Files Tab 键：每个条目一个常驻、非会话的 Tab（ADR-0005）。Project 排在 Git Tab 之后，键形如
// `files:<项目路径>`；Server 排在 Status Tab 之后，键形如 `files:server:<id>`（见 docs/prd/server-files.md）。
export function filesTabKey(entryKey: string): string {
  return `files:${entryKey}`
}

export function isFilesTabKey(key: string): boolean {
  return key.startsWith('files:')
}

// Status Tab 键：每台 Server 一个常驻、非会话的 Tab，排在它的 Tab 栏最前（见 docs/prd/server-status.md）。
// entryKey 即 `server:<id>`，键形如 `status:server:<id>`。
export function statusTabKey(entryKey: string): string {
  return `status:${entryKey}`
}

export function isStatusTabKey(key: string): boolean {
  return key.startsWith('status:')
}

/** 常驻非会话 Tab（Git / Files / Status）：Cmd+W / closeTab 均为 no-op。 */
export function isResidentTabKey(key: string): boolean {
  return isGitTabKey(key) || isFilesTabKey(key) || isStatusTabKey(key)
}
