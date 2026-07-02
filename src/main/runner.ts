import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { IPC } from '../shared/ipc'
import { configKey, scriptKey } from '../shared/runnable'
import type {
  RunTarget,
  SessionBufferSnapshot,
  SessionState,
  SessionStatus,
  TerminalInfo
} from '../shared/types'
import { buildScriptCommand, buildShellInvocation, buildShellSession, resolveCwd } from './command'
import { detectPackageManager } from './discovery'
import { getConfigs } from './store'

interface Session {
  key: string
  /** run = 某条配置的一次执行；terminal = 项目下的自由 shell（术语见 CONTEXT.md） */
  kind: 'run' | 'terminal'
  /** 仅 terminal 使用：其所属项目，供渲染端重建 Tab 与按项目清理 */
  projectPath?: string
  pty: IPty
  status: SessionStatus
  exitCode: number | null
  buffer: string
  /** 累计输出字节长度（单调递增、不随 buffer 截断回退）；随每次 sessionOutput 下发，供回填去重 */
  bytes: number
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

// 进程输出统一入口：追加进环形缓冲并推给渲染端。被新会话取代的旧会话不再产生输出。
function pipeOutput(session: Session): void {
  session.pty.onData((data) => {
    if (sessions.get(session.key) !== session) return
    session.buffer += data
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER)
    session.bytes += data.length
    post(IPC.sessionOutput, { key: session.key, data, bytes: session.bytes })
  })
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

  const header = runHeader(resolved)
  const session: Session = {
    key: resolved.key,
    kind: 'run',
    pty,
    status: 'running',
    exitCode: null,
    buffer: header,
    bytes: header.length,
    cols,
    rows
  }
  sessions.set(resolved.key, session)
  emitStatus(session)
  pipeOutput(session)

  pty.onExit(({ exitCode }) => {
    if (sessions.get(session.key) !== session) return
    // 结束后先空一行，再补「进程已结束，退出代码为 N」（标准色，\x1b[0m 重置防遗留色），并隐藏光标（\x1b[?25l）。
    // 空行按输出是否已换行补足，保证恰好一行空行；写进缓冲并推给正在看的终端。
    const sep = session.buffer.endsWith('\n') ? '\r\n' : '\r\n\r\n'
    const footer = `${sep}\x1b[0m进程已结束，退出代码为 ${exitCode}\r\n\x1b[?25l`
    session.buffer += footer
    session.bytes += footer.length
    post(IPC.sessionOutput, { key: session.key, data: footer, bytes: session.bytes })
    session.status = exitCode === 0 ? 'exited' : 'failed'
    session.exitCode = exitCode
    emitStatus(session)
  })
}

/**
 * 开一个 Terminal（自由 shell）：在项目根目录起登录交互 shell，返回其会话键。
 * 与 Run Session 共用同一套输出/输入/缓冲通道，但无头部、不去重（每个终端独立）；
 * shell 自行结束（exit / Ctrl-D / 崩溃）即销毁并通知渲染端关闭其 Tab。
 */
export function openTerminal(projectPath: string): string {
  const key = `terminal:${randomUUID()}`
  const { file, args } = buildShellSession(process.platform, process.env.SHELL)
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: projectPath,
    env: { ...process.env } as Record<string, string>
  })

  const session: Session = {
    key,
    kind: 'terminal',
    projectPath,
    pty,
    status: 'running',
    exitCode: null,
    buffer: '',
    bytes: 0,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS
  }
  sessions.set(key, session)
  emitStatus(session)
  pipeOutput(session)

  pty.onExit(() => {
    if (sessions.get(key) !== session) return
    sessions.delete(key)
    post(IPC.sessionRemoved, key)
  })

  return key
}

export function getTerminals(): TerminalInfo[] {
  return [...sessions.values()]
    .filter((s) => s.kind === 'terminal')
    .map((s) => ({ key: s.key, projectPath: s.projectPath! }))
}

/** 移除项目时一并杀掉并清除它名下的全部 Terminal。 */
export function disposeTerminalsForProject(projectPath: string): void {
  for (const s of [...sessions.values()]) {
    if (s.kind === 'terminal' && s.projectPath === projectPath) disposeSession(s.key)
  }
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

export function getSessionBuffer(key: string): SessionBufferSnapshot {
  const s = sessions.get(key)
  return s ? { data: s.buffer, bytes: s.bytes } : { data: '', bytes: 0 }
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
