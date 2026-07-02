import { isAbsolute, join } from 'path'
import type { PackageManager } from '../shared/types'

/** 引用型 / 探测脚本的执行命令：`<pm> run <script>`，pm 缺省回退 npm。 */
export function buildScriptCommand(pm: PackageManager | null, scriptName: string): string {
  return `${pm ?? 'npm'} run ${scriptName}`
}

/** 命令型配置的 cwd：相对项目根解析，缺省即项目根。 */
export function resolveCwd(projectPath: string, cwd?: string): string {
  if (!cwd) return projectPath
  return isAbsolute(cwd) ? cwd : join(projectPath, cwd)
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
