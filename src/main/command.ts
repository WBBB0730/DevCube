import { isAbsolute, join, relative } from 'path'
import { SCRIPT_SOURCE, type DiscoverSource } from '../shared/discover-source'
import type { PackageManager } from '../shared/types'
import { conventionCommand, type ProjectFingerprints } from './discovery'

/** 清单脚本的执行命令：`<pm> run <script>`，pm 缺省回退 npm。 */
export function buildScriptCommand(pm: PackageManager | null, scriptName: string): string {
  return `${pm ?? 'npm'} run ${scriptName}`
}

/**
 * 按来源解析引用型 / 探测脚本的命令。
 * 清单脚本走包管理器；约定命令查指纹目录（指纹未命中或无名则 null）。
 */
export function resolveDiscoveredCommand(
  source: DiscoverSource,
  name: string,
  pm: PackageManager | null,
  fingerprints: ProjectFingerprints
): string | null {
  if (source === SCRIPT_SOURCE) return buildScriptCommand(pm, name)
  return conventionCommand(source, name, fingerprints)
}

/** 命令型配置的 cwd：相对项目根解析，缺省即项目根。 */
export function resolveCwd(projectPath: string, cwd?: string): string {
  if (!cwd) return projectPath
  return isAbsolute(cwd) ? cwd : join(projectPath, cwd)
}

/**
 * 系统选中的绝对目录 → 写入配置的 cwd：
 * 等于项目根 → 空串；在项目根下 → 相对路径；否则保留绝对路径。
 */
export function cwdFromPickedDir(projectPath: string, pickedAbs: string): string {
  const rel = relative(projectPath, pickedAbs)
  if (rel === '') return ''
  if (rel.startsWith('..') || isAbsolute(rel)) return pickedAbs
  return rel
}

/** 通过登录 shell 执行命令，保证 PATH / nvm 等像用户终端一样加载（见 Q10）。 */
export function buildShellInvocation(
  command: string,
  platform: NodeJS.Platform,
  shell: string | undefined
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo', '-Command', command] }
  }
  return { file: shell || '/bin/zsh', args: ['-l', '-i', '-c', command] }
}

/** Terminal（自由 shell）的调用：一个登录交互 shell，不带 `-c`——像用户手开一个终端。 */
export function buildShellSession(
  platform: NodeJS.Platform,
  shell: string | undefined
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  return { file: shell || '/bin/zsh', args: ['-l', '-i'] }
}
