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

// 统一的 main→renderer 发送：窗口已销毁（macOS 关窗后进程仍活）时跳过，避免抛异常。
function post(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
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
  post(IPC.sessionStatus, snapshot(s))
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

// 运行前的头部：同一行「工作目录（灰） $ 命令（粗）」，像常见终端的提示符一样先交代「在哪跑、跑什么」。
function runHeader(resolved: Resolved): string {
  return `\x1b[90m${resolved.cwd} $\x1b[0m \x1b[1m${resolved.command}\x1b[0m\r\n`
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
    buffer: runHeader(resolved),
    cols,
    rows
  }
  sessions.set(resolved.key, session)
  emitStatus(session)

  pty.onData((data) => {
    if (sessions.get(session.key) !== session) return // 已被新会话取代
    session.buffer += data
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER)
    post(IPC.sessionOutput, { key: session.key, data })
  })

  pty.onExit(({ exitCode }) => {
    if (sessions.get(session.key) !== session) return
    // 结束后先空一行，再补「进程已结束，退出代码为 N」（标准色，\x1b[0m 重置防遗留色），并隐藏光标（\x1b[?25l）。
    // 空行按输出是否已换行补足，保证恰好一行空行；写进缓冲并推给正在看的终端。
    const sep = session.buffer.endsWith('\n') ? '\r\n' : '\r\n\r\n'
    const footer = `${sep}\x1b[0m进程已结束，退出代码为 ${exitCode}\r\n\x1b[?25l`
    session.buffer += footer
    post(IPC.sessionOutput, { key: session.key, data: footer })
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

/**
 * 彻底销毁一个会话：在跑则先杀进程树，从 Map 移除，并通知渲染端清除其状态。
 * 用于配置被删除 / 对账移除 / 项目移除 —— 区别于用户「停止」（后者保留历史以便回看）。
 */
export function disposeSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  if (session.status === 'running') killTree(session, 'SIGKILL')
  sessions.delete(key)
  post(IPC.sessionRemoved, key)
}

/** 应用退出时清掉所有活跃进程树，避免 dev server 变孤儿。 */
export function killAllSessions(): void {
  for (const session of sessions.values()) {
    if (session.status === 'running') killTree(session, 'SIGKILL')
  }
}
