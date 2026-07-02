import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { spawn, type IPty } from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
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
  /** 会话代际标识（每次 spawn 唯一）。bytes 只在同代内可比，随输出与快照下发供渲染端跨代丢弃 */
  sid: string
  pty: IPty
  status: SessionStatus
  exitCode: number | null
  /**
   * 主进程侧的无头终端：实时消费 pty 输出、跟随 resize，维护「当前屏幕状态」。
   * 回填发 serialize() 的屏幕快照而非原始字节流——原始流跨宽度重放无法保真
   * （zsh 行尾标记 / SIGWINCH 重画等序列依赖产生时的列宽），见 ADR-0004。
   */
  screen: HeadlessTerminal
  serializer: SerializeAddon
  /** 最后一块输出是否以换行收尾（run 会话补退出页脚时决定空行数） */
  endsWithNewline: boolean
  /** 累计输出长度（单调递增）；随每次 sessionOutput 下发，供回填去重 */
  bytes: number
  /**
   * 已被无头终端解析进屏幕的累计长度（xterm 的 write 是异步排队解析）。
   * 快照的 bytes 必须用它：还没进画面的块，渲染端会靠回填去重从 pending 队列补上。
   */
  parsedBytes: number
  cols: number
  rows: number
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
// 与渲染端 xterm 的 scrollback 一致：序列化快照能带回同样多的历史行。
const SCROLLBACK = 10000

function createScreen(
  cols: number,
  rows: number
): { screen: HeadlessTerminal; serializer: SerializeAddon } {
  const screen = new HeadlessTerminal({
    cols,
    rows,
    scrollback: SCROLLBACK,
    allowProposedApi: true
  })
  const serializer = new SerializeAddon()
  screen.loadAddon(serializer)
  return { screen, serializer }
}

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

// 会话输出统一入口：喂给无头终端维护屏幕状态，并推给渲染端。
function emitOutput(session: Session, data: string): void {
  if (data === '') return
  session.endsWithNewline = data.endsWith('\n')
  session.bytes += data.length
  const parsed = session.bytes
  // 回调按写入顺序触发；解析完成后才推进 parsedBytes（快照与画面严格一致）。
  session.screen.write(data, () => {
    session.parsedBytes = parsed
  })
  post(IPC.sessionOutput, { key: session.key, sid: session.sid, data, bytes: session.bytes })
}

// 被新会话取代 / 已销毁的旧会话不再产生输出（onData 可能在 kill 后仍短暂触发）。
function pipeOutput(session: Session): void {
  session.pty.onData((data) => {
    if (sessions.get(session.key) !== session) return
    emitOutput(session, data)
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
  // 单实例：重复运行即先杀旧再起新。旧会话的 onExit / onData 因不再是当前会话而被忽略。
  if (previous) {
    if (previous.status === 'running') killTree(previous, 'SIGKILL')
    previous.screen.dispose() // 释放旧屏幕（新会话随即以同 key 顶替 Map 槽位）
  }

  const { file, args } = buildShellInvocation(resolved.command, process.platform, process.env.SHELL)
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolved.cwd,
    env: { ...process.env, ...resolved.env } as Record<string, string>
  })

  const header = runHeader(resolved)
  const { screen, serializer } = createScreen(cols, rows)
  const session: Session = {
    key: resolved.key,
    kind: 'run',
    sid: randomUUID(),
    pty,
    status: 'running',
    exitCode: null,
    screen,
    serializer,
    endsWithNewline: true,
    bytes: 0,
    parsedBytes: 0,
    cols,
    rows
  }
  sessions.set(resolved.key, session)
  emitStatus(session)
  // 头部走同一输出管道：进无头终端、计入 bytes（渲染端回填去重依赖 bytes 与流内容一致）。
  emitOutput(session, header)
  pipeOutput(session)

  pty.onExit(({ exitCode }) => {
    if (sessions.get(session.key) !== session) return
    // 结束后先空一行，再补「进程已结束，退出代码为 N」（标准色，\x1b[0m 重置防遗留色），并隐藏光标（\x1b[?25l）。
    // 空行按输出是否已换行收尾补足，保证恰好一行空行。
    const sep = session.endsWithNewline ? '\r\n' : '\r\n\r\n'
    emitOutput(session, `${sep}\x1b[0m进程已结束，退出代码为 ${exitCode}\r\n\x1b[?25l`)
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

  const { screen, serializer } = createScreen(DEFAULT_COLS, DEFAULT_ROWS)
  const session: Session = {
    key,
    kind: 'terminal',
    projectPath,
    sid: randomUUID(),
    pty,
    status: 'running',
    exitCode: null,
    screen,
    serializer,
    endsWithNewline: true,
    bytes: 0,
    parsedBytes: 0,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS
  }
  sessions.set(key, session)
  emitStatus(session)
  pipeOutput(session)

  pty.onExit(() => {
    if (sessions.get(key) !== session) return
    session.screen.dispose()
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
  // 尺寸未变直接早退：避免无谓的 SIGWINCH 触发 shell 重画提示符。
  if (!session || (session.cols === cols && session.rows === rows)) return
  session.cols = cols
  session.rows = rows
  // 无头终端始终跟随（含已退出的会话：序列化快照才与渲染端回放宽度一致）。
  session.screen.resize(cols, rows)
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
  return s
    ? // bytes 用 parsedBytes：快照只保证包含「已解析进屏幕」的内容，未解析块由渲染端去重补上。
      {
        sid: s.sid,
        data: s.serializer.serialize(),
        bytes: s.parsedBytes,
        cols: s.cols,
        rows: s.rows
      }
    : { sid: '', data: '', bytes: 0, cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
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
  session.screen.dispose()
  sessions.delete(key)
  post(IPC.sessionRemoved, key)
}

/**
 * 用户关闭一个 Tab（Run Session 或 Terminal）：运行中则 SIGTERM 温和停止（2s 未退升级
 * SIGKILL——会话已出 Map，onExit 早退不会更新状态，故到点盲发、killTree 自吞已退出的报错），
 * 并立即弃掉会话与输出。区别于 disposeSession 的立杀（那是删除/对账等非用户路径）。
 */
export function closeSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  if (session.status === 'running') {
    killTree(session, 'SIGTERM')
    setTimeout(() => killTree(session, 'SIGKILL'), 2000)
  }
  session.screen.dispose()
  sessions.delete(key)
  post(IPC.sessionRemoved, key)
}

/** 应用退出时清掉所有活跃进程树，避免 dev server 变孤儿。 */
export function killAllSessions(): void {
  for (const session of sessions.values()) {
    if (session.status === 'running') killTree(session, 'SIGKILL')
  }
}
