import { existsSync } from 'fs'
import { dirname, isAbsolute, join, normalize, relative } from 'path'
import { SCRIPT_SOURCE, type DiscoverSource } from '../shared/discover-source'
import type { PackageManager, WindowsShell } from '../shared/types'
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

/** shell 构建选项：posix 用 $SHELL；win32 用偏好 + 可选探测注入（测试）。 */
export interface ShellBuildOptions {
  posixShell?: string
  windowsShell?: WindowsShell
  /** 注入 Git Bash 探测；缺省扫本机常见安装路径 */
  findGitBash?: () => string | null
}

/** WSL / 商店占位 bash，不是 Git Bash。 */
function isWslBash(file: string): boolean {
  const n = normalize(file).toLowerCase().replace(/\//g, '\\')
  return n.includes('\\system32\\bash.exe') || n.includes('\\windowsapps\\')
}

/** 拆 PATH：含 `;` 或 Windows 盘符路径时按 `;`，否则按 posix `:`。 */
function splitPathEnv(pathEnv: string): string[] {
  if (pathEnv.includes(';') || /^[A-Za-z]:[\\/]/.test(pathEnv)) {
    return pathEnv.split(';').filter(Boolean)
  }
  return pathEnv.split(':').filter(Boolean)
}

/** 按 PATH 顺序找可执行文件（Windows 补 `.exe`），与用户终端里敲命令时找到的是同一个；找不到返回 null。 */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform
): string | null {
  const file = platform === 'win32' && !/\.exe$/i.test(name) ? `${name}.exe` : name
  for (const dir of splitPathEnv(env.Path ?? env.PATH ?? '')) {
    const candidate = join(dir, file)
    if (exists(candidate)) return candidate
  }
  return null
}

/** 给定 Git for Windows 安装根，优先 bin\\bash.exe，其次 usr\\bin\\bash.exe。 */
function bashUnderGitRoot(gitRoot: string, exists: (path: string) => boolean): string | null {
  for (const rel of ['bin/bash.exe', 'usr/bin/bash.exe']) {
    const candidate = join(gitRoot, rel)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * 从含 git.exe 的目录反推安装根：
 * `…/Git/cmd`、`…/Git/mingw64/bin`、`…/Git/bin` → `…/Git`。
 */
function gitRootFromGitExeDir(dir: string): string {
  const base = normalize(dir)
  const lower = base.replace(/\//g, '\\').toLowerCase()
  if (lower.endsWith('\\cmd')) return dirname(base)
  if (lower.endsWith('\\mingw64\\bin')) return dirname(dirname(base))
  if (lower.endsWith('\\bin')) return dirname(base)
  return base
}

/**
 * 探测 Git for Windows 的 bash.exe（通用，不绑定固定盘符）：
 * 常见安装根 → PATH 旁路 git.exe 反推安装根 → PATH 上非 WSL 的 bash.exe。
 */
export function findGitBash(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const bases = [
    env['ProgramW6432'],
    env['ProgramFiles(x86)'],
    env['ProgramFiles'],
    env['LocalAppData'] ? join(env['LocalAppData'], 'Programs') : undefined
  ]
  for (const base of bases) {
    if (!base) continue
    const hit = bashUnderGitRoot(join(base, 'Git'), exists)
    if (hit) return hit
  }

  // PATH：旁路 git.exe 推安装根；再收非 WSL 的 bash.exe（覆盖自定义安装路径）
  // Windows Path 用 `;`；不可按 `:` 切，否则会拆掉 `D:\...` 盘符。
  const pathDirs = splitPathEnv(env.Path ?? env.PATH ?? '')
  for (const dir of pathDirs) {
    if (exists(join(dir, 'git.exe'))) {
      const hit = bashUnderGitRoot(gitRootFromGitExeDir(dir), exists)
      if (hit) return hit
    }
  }
  for (const dir of pathDirs) {
    const bash = join(dir, 'bash.exe')
    if (exists(bash) && !isWslBash(bash)) return bash
  }
  return null
}

/**
 * 按偏好解析 Windows shell 可执行文件。
 * git-bash 探测失败时回退 powershell（ADR-0022）。
 */
export function resolveWindowsShell(
  pref: WindowsShell,
  findBash: () => string | null = findGitBash
): { shell: WindowsShell; file: string } {
  if (pref === 'cmd') return { shell: 'cmd', file: 'cmd.exe' }
  if (pref === 'powershell') return { shell: 'powershell', file: 'powershell.exe' }
  const bash = findBash()
  if (bash) return { shell: 'git-bash', file: bash }
  return { shell: 'powershell', file: 'powershell.exe' }
}

/** 运行头打印所用的 shell 族（git-bash / posix 均走 sh 风格）。 */
export type RunHeaderShell = 'sh' | 'powershell' | 'cmd'

function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * 服务器状态脚本的远端命令：`sh -c '<脚本>'`，交给服务器自带的 sh 执行，不依赖登录 shell 的语法
 * （脚本见 shared/server-status 的 STATUS_SCRIPT）。
 */
export function buildRemoteStatusCommand(script: string): string {
  return `sh -c ${shSingleQuote(script)}`
}

function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * 把运行头变成 shell 真正打印的输出，再执行用户命令（ADR-0023）。
 * 头在 ConPTY/shell 启动清屏之后出现，仍留在输出流里。
 */
export function wrapWithRunHeader(command: string, cwd: string, shell: RunHeaderShell): string {
  if (shell === 'powershell') {
    return (
      `Write-Host (-join([char]27,'[90m',${psSingleQuote(cwd)},' $',[char]27,'[0m ',` +
      `[char]27,'[1m',${psSingleQuote(command)},[char]27,'[0m')); ${command}`
    )
  }
  if (shell === 'cmd') {
    const header = `\x1b[90m${cwd} $\x1b[0m \x1b[1m${command}\x1b[0m`
    return `echo ${`"${header.replace(/"/g, '""')}"`}&${command}`
  }
  return `${shRunHeader(cwd, command)}; ${command}`
}

/** sh 风格的运行头：灰色「目录 $」+ 加粗命令（本机 sh 族与服务器上共用）。 */
function shRunHeader(cwd: string, command: string): string {
  return (
    `printf '\\033[90m%s $\\033[0m \\033[1m%s\\033[0m\\n' ` +
    `${shSingleQuote(cwd)} ${shSingleQuote(command)}`
  )
}

/** 服务器上的 cd 目标：`~` 与 `~/…` 保留波浪线展开，其余整体加引号。 */
function remoteCdTarget(cwd: string): string {
  if (cwd === '~') return '~'
  if (cwd.startsWith('~/')) return `~/${shSingleQuote(cwd.slice(2))}`
  return shSingleQuote(cwd)
}

/**
 * 服务器上的命令型配置交给远端登录 shell 执行的命令串（按 POSIX sh 语法）：
 * 先由远端 shell 打印运行头（同 ADR-0023，头由执行命令的 shell 打印），再进工作目录、
 * 导出环境变量、执行命令；任一步失败即停。工作目录缺省时头里显示 `~`（登录后的目录）。
 */
export function buildRemoteRunCommand(
  command: string,
  cwd: string | undefined,
  env: Record<string, string> | undefined
): string {
  const steps = [
    ...(cwd ? [`cd ${remoteCdTarget(cwd)}`] : []),
    ...Object.entries(env ?? {}).map(([key, value]) => `export ${key}=${shSingleQuote(value)}`),
    command
  ]
  return `${shRunHeader(cwd || '~', command)}; ${steps.join(' && ')}`
}

/**
 * 「在 SSH 终端中打开」：登录后先进目录，再以登录 shell 替换自己，得到与直接 ssh 登录一样的交互 shell
 * （按 POSIX sh 语法，同 buildRemoteRunCommand）。目录是 Files Tab 里的绝对路径。
 */
export function buildRemoteShellInDir(dir: string): string {
  return `cd ${shSingleQuote(dir)} && exec "$SHELL" -l`
}

/** WindowsShell / posix → 运行头包装所用的 shell 族。 */
export function runHeaderShellFor(
  platform: NodeJS.Platform,
  windowsShell: WindowsShell | undefined,
  findBash: () => string | null = findGitBash
): RunHeaderShell {
  if (platform !== 'win32') return 'sh'
  const { shell } = resolveWindowsShell(windowsShell ?? 'git-bash', findBash)
  if (shell === 'powershell') return 'powershell'
  if (shell === 'cmd') return 'cmd'
  return 'sh'
}

/** 通过登录 shell 执行命令，保证 PATH / nvm 等像用户终端一样加载（见 Q10）。 */
export function buildShellInvocation(
  command: string,
  platform: NodeJS.Platform,
  options: ShellBuildOptions = {}
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const { shell, file } = resolveWindowsShell(
      options.windowsShell ?? 'git-bash',
      options.findGitBash
    )
    if (shell === 'git-bash') return { file, args: ['-l', '-i', '-c', command] }
    if (shell === 'cmd') return { file, args: ['/d', '/s', '/c', command] }
    return { file, args: ['-NoLogo', '-Command', command] }
  }
  return { file: options.posixShell || '/bin/zsh', args: ['-l', '-i', '-c', command] }
}

/** Terminal（自由 shell）的调用：一个登录交互 shell，不带 `-c`——像用户手开一个终端。 */
export function buildShellSession(
  platform: NodeJS.Platform,
  options: ShellBuildOptions = {}
): { file: string; args: string[] } {
  if (platform === 'win32') {
    const { shell, file } = resolveWindowsShell(
      options.windowsShell ?? 'git-bash',
      options.findGitBash
    )
    if (shell === 'git-bash') return { file, args: ['-l', '-i'] }
    if (shell === 'cmd') return { file, args: [] }
    return { file, args: ['-NoLogo'] }
  }
  return { file: options.posixShell || '/bin/zsh', args: ['-l', '-i'] }
}

/** 缺省语言环境跟界面语言走（界面只有简体中文，见 ADR-0037），同 VS Code 终端的做法。 */
const TERMINAL_DEFAULT_LANG = 'zh_CN.UTF-8'

/**
 * Terminal / Run Session 的 pty 环境：LANG 缺失或不是 UTF-8 时补 `zh_CN.UTF-8`，已是 UTF-8 则原样。
 * 从 Finder / 程序坞启动的 GUI 应用环境里没有 LANG，shell 落到 C 语言环境：提示符里的中文路径乱码、
 * `ls` 把中文文件名打成问号、less（git log 的分页器）把中文当二进制。
 * 判定规则照 VS Code `terminal.integrated.detectLocale` 的缺省（auto）。
 */
export function withTerminalLocale(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const lang = env.LANG
  const utf8 = !!lang && (/\.UTF-8$/.test(lang) || /\.utf8$/.test(lang) || /\.euc.+/.test(lang))
  return utf8 ? { ...env } : { ...env, LANG: TERMINAL_DEFAULT_LANG }
}
