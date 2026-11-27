import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import {
  OPEN_IN_APP_IDS,
  OPEN_IN_APP_LABELS,
  buildClaudeCodeNewSessionUrl,
  buildCodexNewThreadUrl,
  unavailableReasonFor,
  type OpenInAppId,
  type OpenInAppResult
} from '../shared/open-in-app'
import { resolveShellEnvironment } from './shell-env'

const execFileAsync = promisify(execFile)

/** T3 Code 官方各发布渠道的桌面应用名（正式版优先）。 */
const T3_APP_NAMES = ['T3 Code', 'T3 Code (Beta)', 'T3 Code (Nightly)', 'T3 Code (Alpha)'] as const

const T3_LAUNCH_TIMEOUT_MS = 15_000
const T3_POLL_INTERVAL_MS = 400
const EXEC_TIMEOUT_MS = 15_000

export type ExecCommandResult = { ok: true } | { ok: false; error: string }

export type OpenInAppDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homedir: () => string
  pathExists: (path: string) => Promise<boolean>
  commandOnPath: (command: string) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** 分离启动外部进程（CLI / 应用可执行文件） */
  spawnDetached: (file: string, args: string[]) => Promise<void>
  /** 执行短命令并等待退出结果（用于需要确认是否成功的 CLI，如 `t3 app`） */
  execCommand: (file: string, args: string[]) => Promise<ExecCommandResult>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

async function getRuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  if (process.platform === 'win32') return process.env
  try {
    return { ...process.env, ...(await resolveShellEnvironment()) }
  } catch {
    return process.env
  }
}

async function resolveWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('where', [command], { windowsHide: true, env })
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.find((line) => /\.(exe|cmd|bat)$/i.test(line)) ?? lines[0] ?? null
  } catch {
    return null
  }
}

function quoteCmdArg(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}

function formatExecError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown }
    if (typeof e.stderr === 'string' && e.stderr.trim()) return e.stderr.trim()
    if (typeof e.stdout === 'string' && e.stdout.trim()) return e.stdout.trim()
    if (typeof e.message === 'string' && e.message.trim()) return e.message.trim()
  }
  return String(err)
}

const defaultDeps: OpenInAppDeps = {
  platform: process.platform,
  env: process.env,
  homedir,
  pathExists: async (path) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  },
  commandOnPath: async (command) => {
    const env = await getRuntimeEnv()
    try {
      if (process.platform === 'win32') {
        await execFileAsync('where', [command], { windowsHide: true, env })
      } else {
        await execFileAsync('which', [command], { env })
      }
      return true
    } catch {
      return false
    }
  },
  openExternal: (url) => shell.openExternal(url),
  spawnDetached: async (file, args) => {
    const env = await getRuntimeEnv()
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env
      })
      let settled = false
      child.once('error', (err) => {
        if (!settled) {
          settled = true
          reject(err)
        }
      })
      child.once('spawn', () => {
        if (!settled) {
          settled = true
          child.unref()
          resolve()
        }
      })
    })
  },
  execCommand: async (file, args) => {
    const env = await getRuntimeEnv()
    try {
      if (process.platform === 'win32') {
        const resolved =
          /[\\/]/.test(file) || /\.[a-z0-9]+$/i.test(file)
            ? file
            : ((await resolveWindowsCommand(file, env)) ?? file)
        if (/\.(cmd|bat)$/i.test(resolved)) {
          const commandLine = `"${quoteCmdArg(resolved)} ${args.map(quoteCmdArg).join(' ')}"`
          await execFileAsync('cmd.exe', ['/d', '/s', '/c', commandLine], {
            windowsVerbatimArguments: true,
            windowsHide: true,
            timeout: EXEC_TIMEOUT_MS,
            env
          })
          return { ok: true }
        }
        await execFileAsync(resolved, args, {
          windowsHide: true,
          timeout: EXEC_TIMEOUT_MS,
          env
        })
        return { ok: true }
      }
      await execFileAsync(file, args, { timeout: EXEC_TIMEOUT_MS, env })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: formatExecError(err) }
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now()
}

/** 候选可执行文件 / .app 路径（按平台；存在任一即可用）。 */
export function candidateAppPaths(
  id: OpenInAppId,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  if (platform === 'darwin') {
    // 用 posix.join：单测在 Windows CI 也会测 darwin 候选，避免 path.join 产出反斜杠。
    switch (id) {
      case 'cursor':
        return ['/Applications/Cursor.app', posix.join(home, 'Applications/Cursor.app')]
      case 'codex':
        // Codex Desktop 现随 ChatGPT.app（bundle id com.openai.codex）分发
        return [
          '/Applications/ChatGPT.app',
          '/Applications/Codex.app',
          posix.join(home, 'Applications/ChatGPT.app'),
          posix.join(home, 'Applications/Codex.app')
        ]
      case 'claude':
        return ['/Applications/Claude.app', posix.join(home, 'Applications/Claude.app')]
      case 't3code':
        return [
          ...T3_APP_NAMES.map((name) => `/Applications/${name}.app`),
          ...T3_APP_NAMES.map((name) => posix.join(home, `Applications/${name}.app`))
        ]
    }
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local')
    const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files'
    switch (id) {
      case 'cursor':
        return [
          win32.join(local, 'Programs', 'cursor', 'Cursor.exe'),
          win32.join(programFiles, 'Cursor', 'Cursor.exe')
        ]
      case 'codex':
        return [
          win32.join(local, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
          win32.join(local, 'Programs', 'codex', 'Codex.exe'),
          win32.join(programFiles, 'ChatGPT', 'ChatGPT.exe')
        ]
      case 'claude':
        return [
          win32.join(local, 'AnthropicClaude', 'claude.exe'),
          win32.join(local, 'Programs', 'Claude', 'Claude.exe')
        ]
      case 't3code':
        // electron-builder NSIS 默认装在 Programs\t3code\<productName>.exe（package.json name 为 t3code）
        return [
          ...T3_APP_NAMES.map((name) => win32.join(local, 'Programs', 't3code', `${name}.exe`)),
          ...T3_APP_NAMES.map((name) => win32.join(programFiles, 't3code', `${name}.exe`)),
          ...T3_APP_NAMES.map((name) => win32.join(local, 'Programs', name, `${name}.exe`)),
          ...T3_APP_NAMES.map((name) => win32.join(programFiles, name, `${name}.exe`))
        ]
    }
  }
  // linux：主要靠 PATH 上的 CLI；桌面入口因发行版差异大，不硬编码
  return []
}

/** 固定目录里的官方 CLI 入口（即使尚未加入 PATH 也可命中，例如 T3 Code 首次启动写入的 `~/.t3/bin/t3`）。 */
export function candidateCliPaths(
  id: OpenInAppId,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  if (id !== 't3code') return []
  const configuredHome = env.T3CODE_HOME?.trim()
  if (platform === 'win32') {
    const t3Home = configuredHome || win32.join(home, '.t3')
    return [win32.join(t3Home, 'bin', 't3.cmd'), win32.join(t3Home, 'bin', 't3.exe')]
  }
  const t3Home = configuredHome || posix.join(home, '.t3')
  return [posix.join(t3Home, 'bin', 't3'), posix.join(home, '.local', 'bin', 't3')]
}

/** PATH 上用于探测/启动的 CLI 名（Codex/Claude 桌面优先 deep link，CLI 作 Codex 回退；T3 Code 走 `t3 app`）。 */
export function candidateCliNames(
  id: OpenInAppId,
  platform: NodeJS.Platform = process.platform
): string[] {
  switch (id) {
    case 'cursor':
      return ['cursor']
    case 'codex':
      return ['codex']
    case 'claude':
      // 桌面会话走 claude://；CLI 不能代表 Desktop 已装
      return []
    case 't3code':
      return platform === 'linux' ? ['t3', 't3code'] : ['t3']
  }
}

export async function isAppAvailable(
  id: OpenInAppId,
  deps: OpenInAppDeps = defaultDeps
): Promise<boolean> {
  const home = deps.homedir()
  const paths = [
    ...candidateAppPaths(id, deps.platform, deps.env, home),
    ...candidateCliPaths(id, deps.platform, deps.env, home)
  ]
  for (const p of paths) {
    if (await deps.pathExists(p)) return true
  }
  for (const cmd of candidateCliNames(id, deps.platform)) {
    if (await deps.commandOnPath(cmd)) return true
  }
  return false
}

/** 返回当前本机已安装的「打开于」工具列表（按字母序）。 */
export async function listOpenInApps(deps: OpenInAppDeps = defaultDeps): Promise<OpenInAppId[]> {
  const checks = await Promise.all(
    OPEN_IN_APP_IDS.map(async (id) => ({ id, available: await isAppAvailable(id, deps) }))
  )
  return checks.filter((item) => item.available).map((item) => item.id)
}

async function firstExistingPath(
  paths: string[],
  pathExists: OpenInAppDeps['pathExists']
): Promise<string | null> {
  for (const p of paths) {
    if (await pathExists(p)) return p
  }
  return null
}

export async function openInApp(
  id: OpenInAppId,
  projectPath: string,
  deps: OpenInAppDeps = defaultDeps
): Promise<OpenInAppResult> {
  try {
    switch (id) {
      case 'cursor':
        return await openCursor(projectPath, deps)
      case 'codex':
        return await openCodex(projectPath, deps)
      case 'claude':
        return await openClaude(projectPath, deps)
      case 't3code':
        return await openT3Code(projectPath, deps)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `无法打开 ${OPEN_IN_APP_LABELS[id]}：${message}` }
  }
}

async function openCursor(projectPath: string, deps: OpenInAppDeps): Promise<OpenInAppResult> {
  if (await deps.commandOnPath('cursor')) {
    await deps.spawnDetached('cursor', [projectPath])
    return { ok: true }
  }
  if (deps.platform === 'darwin') {
    const app = await firstExistingPath(
      candidateAppPaths('cursor', deps.platform, deps.env, deps.homedir()),
      deps.pathExists
    )
    if (app) {
      await deps.spawnDetached('open', ['-a', app, projectPath])
      return { ok: true }
    }
  }
  if (deps.platform === 'win32') {
    const exe = await firstExistingPath(
      candidateAppPaths('cursor', deps.platform, deps.env, deps.homedir()),
      deps.pathExists
    )
    if (exe) {
      await deps.spawnDetached(exe, [projectPath])
      return { ok: true }
    }
  }
  return { ok: false, error: unavailableReasonFor('cursor') }
}

async function openCodex(projectPath: string, deps: OpenInAppDeps): Promise<OpenInAppResult> {
  const hasApp =
    (await firstExistingPath(
      candidateAppPaths('codex', deps.platform, deps.env, deps.homedir()),
      deps.pathExists
    )) !== null
  const hasCli = await deps.commandOnPath('codex')
  if (!hasApp && !hasCli) return { ok: false, error: unavailableReasonFor('codex') }

  // 有 Desktop 时优先官方 deep link；失败或仅有 CLI 时用 `codex app`
  if (hasApp) {
    try {
      await deps.openExternal(buildCodexNewThreadUrl(projectPath))
      return { ok: true }
    } catch {
      // fall through to CLI
    }
  }
  if (hasCli) {
    await deps.spawnDetached('codex', ['app', projectPath])
    return { ok: true }
  }
  return { ok: false, error: unavailableReasonFor('codex') }
}

async function openClaude(projectPath: string, deps: OpenInAppDeps): Promise<OpenInAppResult> {
  if (!(await isAppAvailable('claude', deps))) {
    return { ok: false, error: unavailableReasonFor('claude') }
  }
  await deps.openExternal(buildClaudeCodeNewSessionUrl(projectPath))
  return { ok: true }
}

async function resolveT3Cli(deps: OpenInAppDeps): Promise<string | null> {
  if (await deps.commandOnPath('t3')) return 't3'
  return firstExistingPath(
    candidateCliPaths('t3code', deps.platform, deps.env, deps.homedir()),
    deps.pathExists
  )
}

async function resolveT3DesktopTarget(deps: OpenInAppDeps): Promise<string | null> {
  const appPath = await firstExistingPath(
    candidateAppPaths('t3code', deps.platform, deps.env, deps.homedir()),
    deps.pathExists
  )
  if (appPath) return appPath
  if (deps.platform === 'linux' && (await deps.commandOnPath('t3code'))) return 't3code'
  return null
}

function isT3DesktopNotReadyError(message: string): boolean {
  return /could not reach the t3 code desktop app|renderer-unavailable|environment-unavailable|has moved or been removed/i.test(
    message
  )
}

async function launchT3Desktop(target: string, deps: OpenInAppDeps): Promise<void> {
  if (deps.platform === 'darwin') {
    await deps.spawnDetached('open', ['-a', target])
  } else {
    await deps.spawnDetached(target, [])
  }
}

async function openT3Code(projectPath: string, deps: OpenInAppDeps): Promise<OpenInAppResult> {
  const cli = await resolveT3Cli(deps)
  const desktopTarget = await resolveT3DesktopTarget(deps)
  if (!cli && !desktopTarget) return { ok: false, error: unavailableReasonFor('t3code') }

  // 桌面端已在运行时直接调用 `t3 app <projectPath>`，零延迟
  if (cli) {
    const first = await deps.execCommand(cli, ['app', projectPath])
    if (first.ok) return { ok: true }
    if (!isT3DesktopNotReadyError(first.error)) {
      return { ok: false, error: `无法打开 ${OPEN_IN_APP_LABELS.t3code}：${first.error}` }
    }
    if (!desktopTarget) {
      return { ok: false, error: '未检测到运行中的 T3 Code 桌面端，请先手动启动 T3 Code' }
    }
  }

  // 桌面端未启动或尚未就绪：自动拉起桌面端，轮询等待控制通道就绪（同时等待首次启动写出 shim）
  if (!desktopTarget) return { ok: false, error: unavailableReasonFor('t3code') }
  await launchT3Desktop(desktopTarget, deps)

  const deadline = deps.now() + T3_LAUNCH_TIMEOUT_MS
  let lastError = ''
  while (deps.now() < deadline) {
    await deps.sleep(T3_POLL_INTERVAL_MS)
    const readyCli = await resolveT3Cli(deps)
    if (!readyCli) continue
    const attempt = await deps.execCommand(readyCli, ['app', projectPath])
    if (attempt.ok) return { ok: true }
    if (!isT3DesktopNotReadyError(attempt.error)) {
      return { ok: false, error: `无法打开 ${OPEN_IN_APP_LABELS.t3code}：${attempt.error}` }
    }
    lastError = attempt.error
  }

  return {
    ok: false,
    error: lastError
      ? `T3 Code 启动超时，请在 T3 Code 就绪后重试（${lastError}）`
      : 'T3 Code 启动超时，请在 T3 Code 就绪后重试'
  }
}
