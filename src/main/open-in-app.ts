import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import {
  OPEN_IN_APP_IDS,
  OPEN_IN_APP_LABELS,
  buildClaudeCodeNewSessionUrl,
  buildCodexNewThreadUrl,
  unavailableReasonFor,
  type OpenInAppId,
  type OpenInAppResult,
  type OpenInAppStatus
} from '../shared/open-in-app'

const execFileAsync = promisify(execFile)

export type OpenInAppDeps = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homedir: () => string
  pathExists: (path: string) => Promise<boolean>
  commandOnPath: (command: string) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** 分离启动外部进程（CLI / 应用可执行文件） */
  spawnDetached: (file: string, args: string[]) => Promise<void>
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
    try {
      if (process.platform === 'win32') {
        await execFileAsync('where', [command], { windowsHide: true })
      } else {
        await execFileAsync('which', [command])
      }
      return true
    } catch {
      return false
    }
  },
  openExternal: (url) => shell.openExternal(url),
  spawnDetached: async (file, args) => {
    const { spawn } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
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
  }
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
    }
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files'
    switch (id) {
      case 'cursor':
        return [
          join(local, 'Programs', 'cursor', 'Cursor.exe'),
          join(programFiles, 'Cursor', 'Cursor.exe')
        ]
      case 'codex':
        return [
          join(local, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
          join(local, 'Programs', 'codex', 'Codex.exe'),
          join(programFiles, 'ChatGPT', 'ChatGPT.exe')
        ]
      case 'claude':
        return [
          join(local, 'AnthropicClaude', 'claude.exe'),
          join(local, 'Programs', 'Claude', 'Claude.exe')
        ]
    }
  }
  // linux：主要靠 PATH 上的 CLI；桌面入口因发行版差异大，不硬编码
  return []
}

/** PATH 上用于探测/启动的 CLI 名（Codex/Claude 桌面优先 deep link，CLI 作 Codex 回退）。 */
export function candidateCliNames(id: OpenInAppId): string[] {
  switch (id) {
    case 'cursor':
      return ['cursor']
    case 'codex':
      return ['codex']
    case 'claude':
      // 桌面会话走 claude://；CLI 不能代表 Desktop 已装
      return []
  }
}

export async function isAppAvailable(
  id: OpenInAppId,
  deps: OpenInAppDeps = defaultDeps
): Promise<boolean> {
  const paths = candidateAppPaths(id, deps.platform, deps.env, deps.homedir())
  for (const p of paths) {
    if (await deps.pathExists(p)) return true
  }
  for (const cmd of candidateCliNames(id)) {
    if (await deps.commandOnPath(cmd)) return true
  }
  return false
}

export async function listOpenInApps(
  deps: OpenInAppDeps = defaultDeps
): Promise<OpenInAppStatus[]> {
  const statuses = await Promise.all(
    OPEN_IN_APP_IDS.map(async (id) => {
      const available = await isAppAvailable(id, deps)
      const status: OpenInAppStatus = {
        id,
        label: OPEN_IN_APP_LABELS[id],
        available
      }
      if (!available) status.unavailableReason = unavailableReasonFor(id)
      return status
    })
  )
  return statuses
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
