import { BrowserWindow } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { IPC } from '../shared/ipc'
import { configKey, scriptKey } from '../shared/runnable'
import type { RunTarget, SessionState, SessionStatus } from '../shared/types'
import { buildScriptCommand, buildShellInvocation, resolveCwd } from './command'
import { detectPackageManager } from './discovery'
import { getConfigs } from './store'

interface Session {
  key: string
  pty: IPty
  status: SessionStatus
  exitCode: number | null
  buffer: string
  cols: number
  rows: number
}

const MAX_BUFFER = 1_000_000
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

const sessions = new Map<string, Session>()
let win: BrowserWindow | null = null

export function setRunnerWindow(w: BrowserWindow): void {
  win = w
}

interface Resolved {
  key: string
  command: string
  cwd: string
  env?: Record<string, string>
}

function resolveTarget(target: RunTarget): Resolved | null {
  if (target.type === 'script') {
    return {
      key: scriptKey(target.projectPath, target.name),
      command: buildScriptCommand(detectPackageManager(target.projectPath), target.name),
      cwd: target.projectPath
    }
  }
  const config = getConfigs().find((c) => c.id === target.id)
  if (!config) return null
  if (config.kind === 'referenced') {
    return {
      key: configKey(config),
      command: buildScriptCommand(detectPackageManager(config.projectPath), config.scriptName),
      cwd: config.projectPath
    }
  }
  return {
    key: configKey(config),
    command: config.command,
    cwd: resolveCwd(config.projectPath, config.cwd),
    env: config.env
  }
}

function snapshot(s: Session): SessionState {
  return { key: s.key, status: s.status, exitCode: s.exitCode }
}

function emitStatus(s: Session): void {
  win?.webContents.send(IPC.sessionStatus, snapshot(s))
}

// 杀掉整棵进程树：posix 下向进程组发信号，避免 dev server 子进程变孤儿。
function killTree(session: Session, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') session.pty.kill()
    else process.kill(-session.pty.pid, signal)
  } catch {
    try {
      session.pty.kill()
    } catch {
      /* 已退出 */
    }
  }
}

export function run(target: RunTarget): void {
  const resolved = resolveTarget(target)
  if (!resolved) return

  const previous = sessions.get(resolved.key)
  const cols = previous?.cols ?? DEFAULT_COLS
  const rows = previous?.rows ?? DEFAULT_ROWS
  // 单实例：重复运行即先杀旧再起新。旧会话的 onExit 因不再是当前会话而被忽略。
  if (previous && previous.status === 'running') killTree(previous, 'SIGKILL')

  const { file, args } = buildShellInvocation(resolved.command, process.platform, process.env.SHELL)
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolved.cwd,
    env: { ...process.env, ...resolved.env } as Record<string, string>
  })

  const session: Session = {
    key: resolved.key,
    pty,
    status: 'running',
    exitCode: null,
    buffer: '',
    cols,
    rows
  }
  sessions.set(resolved.key, session)
  emitStatus(session)

  pty.onData((data) => {
    if (sessions.get(session.key) !== session) return // 已被新会话取代
    session.buffer += data
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER)
    win?.webContents.send(IPC.sessionOutput, { key: session.key, data })
  })

  pty.onExit(({ exitCode }) => {
    if (sessions.get(session.key) !== session) return
    session.status = exitCode === 0 ? 'exited' : 'failed'
    session.exitCode = exitCode
    emitStatus(session)
  })
}

export function stop(key: string): void {
  const session = sessions.get(key)
  if (!session || session.status !== 'running') return
  killTree(session, 'SIGTERM')
  setTimeout(() => {
    const s = sessions.get(key)
    if (s === session && s.status === 'running') killTree(s, 'SIGKILL')
  }, 2000)
}

export function writeStdin(key: string, data: string): void {
  sessions.get(key)?.pty.write(data)
}

export function resize(key: string, cols: number, rows: number): void {
  const session = sessions.get(key)
  if (!session) return
  session.cols = cols
  session.rows = rows
  if (session.status === 'running') {
    try {
      session.pty.resize(cols, rows)
    } catch {
      /* 进程可能刚退出 */
    }
  }
}

export function getSessionBuffer(key: string): string {
  return sessions.get(key)?.buffer ?? ''
}

export function getSessions(): SessionState[] {
  return [...sessions.values()].map(snapshot)
}

/** 应用退出时清掉所有活跃进程树，避免 dev server 变孤儿。 */
export function killAllSessions(): void {
  for (const session of sessions.values()) {
    if (session.status === 'running') killTree(session, 'SIGKILL')
  }
}
