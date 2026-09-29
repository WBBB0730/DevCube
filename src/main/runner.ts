import { randomUUID } from 'crypto'
import { statSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { spawn, type IPty } from 'node-pty'
import type { ClientChannel, PseudoTtyOptions } from 'ssh2'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { IPC } from '../shared/ipc'
import { configKey, scriptKey } from '../shared/runnable'
import { resolveWithinProject } from '../shared/files-path'
import type { QuitGuardSession } from '../shared/quit-guard'
import type { Server } from '../shared/server'
import type {
  RemoteRunConfig,
  RunTarget,
  SessionBufferSnapshot,
  SessionState,
  SessionStatus,
  TerminalInfo
} from '../shared/types'
import {
  buildRemoteRunCommand,
  buildRemoteShellInDir,
  buildShellInvocation,
  buildShellSession,
  resolveCwd,
  resolveDiscoveredCommand,
  runHeaderShellFor,
  withTerminalLocale,
  wrapWithRunHeader
} from './command'
import { detectPackageManager, readFingerprints } from './discovery'
import { findServer } from './servers'
import { connectSsh, onSshClosed } from './ssh-connect'
import { getAppPrefs, getConfigs } from './store'

/**
 * 会话背后跑着的东西：本机是 PTY 里的进程（node-pty）；服务器上是内置连接（ADR-0041）上一个带伪终端的通道。
 */
interface SessionProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  /**
   * 结束：本机向整棵进程树发信号（posix 发给进程组，免得 dev server 子进程变孤儿）；
   * 服务器上断开连接（SIGKILL 为直接断开），远端进程随之收到挂断（同关掉 ssh）。
   */
  kill(signal: NodeJS.Signals): void
}

interface Session {
  key: string
  /**
   * run = 某条配置的一次执行；terminal = 项目下的自由 shell；
   * ssh = 连到某台服务器的 SSH Terminal，断开后会话保留、可原地重连（术语见 CONTEXT.md）
   */
  kind: 'run' | 'terminal' | 'ssh'
  /** terminal / ssh 使用：所属左树条目（Project 路径或 `server:<id>`），供渲染端重建 Tab 与按条目清理 */
  ownerKey?: string
  /** 仅 ssh：所连服务器 */
  serverId?: string
  /** 仅 ssh：登录后进入的目录（Files Tab「在 SSH 终端中打开」）；重连照旧进入，不随壳持久化 */
  remoteCwd?: string
  /** 会话代际标识（每次 spawn 唯一）。bytes 只在同代内可比，随输出与快照下发供渲染端跨代丢弃 */
  sid: string
  /** 尚未连接、正在连接或已结束时为 null */
  proc: SessionProcess | null
  /** 正在连接服务器（服务器上的会话）：关掉 Tab、停止时中止，撤下还没回答的提问 */
  connecting: AbortController | null
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

/** 本机执行（经登录 shell）的配置 / 探测脚本解析结果。 */
interface Resolved {
  type: 'local'
  key: string
  command: string
  cwd: string
  env?: Record<string, string>
}

/** 在服务器上执行的配置。 */
interface ResolvedRemote {
  type: 'remote'
  key: string
  config: RemoteRunConfig
}

/** 要在本机 PTY 里启动的进程。 */
interface Launch {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

/** 本机执行：经登录 shell，运行头由 shell 打印（在 ConPTY 启动清屏之后，ADR-0023）。 */
function localLaunch(resolved: Resolved): Launch {
  const windowsShell = getAppPrefs().windowsShell
  const command = wrapWithRunHeader(
    resolved.command,
    resolved.cwd,
    runHeaderShellFor(process.platform, windowsShell)
  )
  const { file, args } = buildShellInvocation(command, process.platform, {
    posixShell: process.env.SHELL,
    windowsShell
  })
  return {
    file,
    args,
    cwd: resolved.cwd,
    // 配置里写的 env（含 LANG）优先于缺省语言环境
    env: { ...withTerminalLocale(process.env), ...resolved.env } as Record<string, string>
  }
}

function resolveTarget(target: RunTarget): Resolved | ResolvedRemote | null {
  if (target.type === 'script') {
    const command = resolveDiscoveredCommand(
      target.source,
      target.name,
      detectPackageManager(target.projectPath),
      readFingerprints(target.projectPath)
    )
    if (!command) return null
    return {
      type: 'local',
      key: scriptKey(target.projectPath, target.source, target.name),
      command,
      cwd: target.projectPath
    }
  }
  const config = getConfigs().find((c) => c.id === target.id)
  if (!config) return null
  if (config.kind === 'referenced') {
    const command = resolveDiscoveredCommand(
      config.source,
      config.scriptName,
      detectPackageManager(config.projectPath),
      readFingerprints(config.projectPath)
    )
    if (!command) return null
    return {
      type: 'local',
      key: configKey(config),
      command,
      cwd: config.projectPath
    }
  }
  if (config.kind === 'remote') return { type: 'remote', key: configKey(config), config }
  return {
    type: 'local',
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

// 被新会话取代 / 已销毁的旧会话、被重连替换掉的旧进程不再产生输出（onData 可能在 kill 后仍短暂触发）。
function outputOf(session: Session, proc: SessionProcess): (data: string) => void {
  return (data) => {
    if (sessions.get(session.key) !== session || session.proc !== proc) return
    emitOutput(session, data)
  }
}

/** 本机 PTY 里的进程。 */
function ptyProcess(pty: IPty): SessionProcess {
  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => {
      try {
        if (process.platform === 'win32') pty.kill()
        else process.kill(-pty.pid, signal)
      } catch {
        try {
          pty.kill()
        } catch {
          /* 已退出 */
        }
      }
    }
  }
}

/** 结束会话背后的进程；还在连接服务器时取消连接。 */
function killProcess(session: Session, signal: NodeJS.Signals): void {
  session.connecting?.abort()
  session.proc?.kill(signal)
}

/** 服务器上的会话怎么结束：自己退出为退出代码（被信号结束等没有报告时为 null），连接意外断开为原因。 */
type RemoteEnd = { exitCode: number | null } | { reason: string }

/**
 * 连上服务器，在 session 里开一个带伪终端的通道（ADR-0041），开好即成为它的进程。command 为 null 时是
 * 登录 shell（ssh 配置里有 RemoteCommand 则执行它，同 ssh），否则执行 command。环境变量按 ssh 配置的
 * SendEnv / SetEnv；服务器的欢迎横幅写进会话。连不上时抛出（原因在 message 里）；连接期间会话被关掉或停止
 * 时也抛出，什么都不留下。onEnd：连接结束时调用（会话已被取代时不调）。
 */
async function openRemoteSession(
  session: Session,
  server: Server,
  command: string | null,
  onEnd: (end: RemoteEnd) => void
): Promise<void> {
  const controller = new AbortController()
  session.connecting = controller
  const current = (): boolean => sessions.get(session.key) === session && !controller.signal.aborted
  try {
    const { client, config, sessionEnv } = await connectSsh({
      target: server.target,
      direct: server.direct,
      serverId: server.id,
      password: undefined,
      testing: false,
      signal: controller.signal,
      onBanner: (message) => {
        if (current()) emitOutput(session, message.replace(/\r?\n/g, '\r\n'))
      }
    })
    const pty: PseudoTtyOptions = { term: 'xterm-256color', cols: session.cols, rows: session.rows }
    const run = command ?? config.remoteCommand
    await new Promise<void>((resolve, reject) => {
      const onChannel = (error: Error | undefined, channel: ClientChannel): void => {
        if (error || !current()) {
          client.end()
          reject(new Error(error ? `无法打开终端：${error.message}` : '已取消'))
          return
        }
        const proc: SessionProcess = {
          write: (data) => void channel.write(data),
          resize: (cols, rows) => void channel.setWindow(rows, cols, 0, 0),
          // SIGKILL 直接断开：网络不通时 end 要等到保活超时才结束
          kill: (signal) => {
            if (signal === 'SIGKILL') client.destroy()
            else client.end()
          }
        }
        // 同步接上：开通道的回复与第一批输出可能在同一个数据包里
        session.proc = proc
        const output = outputOf(session, proc)
        channel.setEncoding('utf8')
        channel.stderr.setEncoding('utf8')
        channel.on('data', output)
        channel.stderr.on('data', output)
        let exitCode: number | null = null
        channel.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null
        })
        channel.once('close', () => client.end())
        onSshClosed(client, (reason) => {
          if (sessions.get(session.key) !== session || session.proc !== proc) return
          onEnd(reason === null ? { exitCode } : { reason })
        })
        resolve()
      }
      if (run === null) client.shell(pty, { env: sessionEnv }, onChannel)
      else client.exec(run, { pty, env: sessionEnv }, onChannel)
    })
  } finally {
    if (session.connecting === controller) session.connecting = null
  }
}

export async function run(target: RunTarget): Promise<void> {
  const resolved = resolveTarget(target)
  if (!resolved) return
  const key = resolved.key

  const previous = sessions.get(key)
  const cols = previous?.cols ?? DEFAULT_COLS
  const rows = previous?.rows ?? DEFAULT_ROWS
  // 单实例：重复运行即先杀旧再起新。旧会话的 onExit / onData 因不再是当前会话而被忽略。
  if (previous) {
    if (previous.status === 'running') killProcess(previous, 'SIGKILL')
    previous.screen.dispose() // 释放旧屏幕（新会话随即以同 key 顶替 Map 槽位）
  }

  // 先占住会话槽位再准备进程：在服务器上执行要等连接（含回答提问），期间再点一次运行会顶替本会话。
  const { screen, serializer } = createScreen(cols, rows)
  const session: Session = {
    key,
    kind: 'run',
    sid: randomUUID(),
    proc: null,
    connecting: null,
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
  sessions.set(key, session)
  emitStatus(session)

  // 服务器上的配置：连接在后台进行（要等回答提问），不让调用方等
  if (resolved.type === 'remote') {
    void runRemote(session, resolved.config)
    return
  }
  const launch = localLaunch(resolved)
  let pty: IPty
  try {
    pty = spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: launch.cwd,
      env: launch.env
    })
  } catch (error) {
    endSession(session, `无法启动：${error instanceof Error ? error.message : String(error)}`, null)
    return
  }
  const proc = ptyProcess(pty)
  session.proc = proc
  pty.onData(outputOf(session, proc))

  pty.onExit(({ exitCode }) => {
    if (sessions.get(session.key) !== session) return
    endSession(session, `进程已结束，退出代码为 ${exitCode}`, exitCode)
  })
}

/** 服务器上的命令型配置：经内置连接在服务器上执行（ADR-0041），运行头由远端 shell 打印。 */
async function runRemote(session: Session, config: RemoteRunConfig): Promise<void> {
  const server = findServer(config.serverId)
  if (!server) {
    endSession(session, '服务器已移除，无法运行', null)
    return
  }
  try {
    await openRemoteSession(
      session,
      server,
      buildRemoteRunCommand(config.command, config.cwd, config.env),
      (end) => {
        if ('reason' in end) endSession(session, `连接已断开：${end.reason}`, null)
        else if (end.exitCode === null) endSession(session, '进程已结束', null)
        else endSession(session, `进程已结束，退出代码为 ${end.exitCode}`, end.exitCode)
      }
    )
  } catch (error) {
    if (sessions.get(session.key) !== session) return
    endSession(session, error instanceof Error ? error.message : String(error), null)
  }
}

/**
 * 会话结束（运行会话跑完或起不来、SSH Terminal 断开或连不上）：先空一行，再补一行说明
 * （标准色，\x1b[0m 重置防遗留色）。空行按输出是否已换行收尾补足，保证恰好一行；没有任何输出时不空行。
 * 运行会话结束即只读，顺带隐藏光标（\x1b[?25l）；SSH Terminal 还要按回车重连，光标留着。
 */
function endSession(session: Session, text: string, exitCode: number | null): void {
  const sep = session.bytes === 0 ? '' : session.endsWithNewline ? '\r\n' : '\r\n\r\n'
  const hideCursor = session.kind === 'run' ? '\x1b[?25l' : ''
  emitOutput(session, `${sep}\x1b[0m${text}\r\n${hideCursor}`)
  session.proc = null
  session.status = exitCode === 0 ? 'exited' : 'failed'
  session.exitCode = exitCode
  emitStatus(session)
}

/** 终端起始目录：限定项目内且存在的目录，越界 / 失效一律回落项目根（cwd 不随壳持久化）。 */
function terminalCwd(projectPath: string, cwd?: string): string {
  if (cwd === undefined) return projectPath
  const logical = resolveWithinProject(projectPath, cwd)
  if (logical === null) return projectPath
  const sys = path.normalize(logical.split('/').join(path.sep))
  try {
    if (statSync(sys).isDirectory()) return sys
  } catch {
    // 目录已不存在：回落项目根
  }
  return projectPath
}

/**
 * 开一个 Terminal（自由 shell）：起登录交互 shell（默认项目根，cwd 可指定项目内目录），
 * 返回其会话键。与 Run Session 共用同一套输出/输入/缓冲通道，但无头部、不去重（每个终端
 * 独立）；shell 自行结束（exit / Ctrl-D / 崩溃）即销毁并通知渲染端关闭其 Tab。
 */
export function openTerminal(projectPath: string, key?: string, cwd?: string): string {
  const sessionKey = key ?? `terminal:${randomUUID()}`
  const existing = sessions.get(sessionKey)
  if (existing) return sessionKey

  const { file, args } = buildShellSession(process.platform, {
    posixShell: process.env.SHELL,
    windowsShell: getAppPrefs().windowsShell
  })
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: terminalCwd(projectPath, cwd),
    env: withTerminalLocale(process.env) as Record<string, string>
  })

  const { screen, serializer } = createScreen(DEFAULT_COLS, DEFAULT_ROWS)
  const proc = ptyProcess(pty)
  const session: Session = {
    key: sessionKey,
    kind: 'terminal',
    ownerKey: projectPath,
    sid: randomUUID(),
    proc,
    connecting: null,
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
  sessions.set(sessionKey, session)
  emitStatus(session)
  pty.onData(outputOf(session, proc))

  pty.onExit(() => {
    if (sessions.get(sessionKey) !== session) return
    session.screen.dispose()
    sessions.delete(sessionKey)
    post(IPC.sessionRemoved, sessionKey)
  })

  return sessionKey
}

export function getTerminals(): TerminalInfo[] {
  return [...sessions.values()]
    .filter((s) => s.kind === 'terminal' || s.kind === 'ssh')
    .map((s) =>
      s.kind === 'ssh'
        ? { key: s.key, ownerKey: s.ownerKey!, serverId: s.serverId! }
        : { key: s.key, ownerKey: s.ownerKey! }
    )
}

/** 移除条目（Project / Server）时一并杀掉并清除它名下的全部 Terminal 与 SSH Terminal。 */
export function disposeTerminalsForEntry(ownerKey: string): void {
  for (const s of [...sessions.values()]) {
    if ((s.kind === 'terminal' || s.kind === 'ssh') && s.ownerKey === ownerKey) {
      disposeSession(s.key)
    }
  }
}

/** 移除服务器时关闭连到它的全部 SSH Terminal（不论开在哪个条目下）。 */
export function disposeSshTerminalsForServer(serverId: string): void {
  for (const s of [...sessions.values()]) {
    if (s.kind === 'ssh' && s.serverId === serverId) disposeSession(s.key)
  }
}

/**
 * 在某左树条目下开一个连到 serverId 的 SSH Terminal，返回其会话键。同 openTerminal 的约定：
 * 不传 key 即新开并立即开始连接（不等连上就返回，Tab 先出来，提问弹窗与报错都落在它里面）；
 * 传 key 是恢复跨重启的壳——只建会话、提示按回车连接（不自动连接），已存在则原样返回。
 * remoteCwd：登录后进入服务器上的这个目录。
 */
export async function openSshTerminal(
  ownerKey: string,
  serverId: string,
  key?: string,
  remoteCwd?: string
): Promise<string> {
  if (key !== undefined && sessions.has(key)) return key
  const sessionKey = key ?? `ssh:${randomUUID()}`
  const { screen, serializer } = createScreen(DEFAULT_COLS, DEFAULT_ROWS)
  const session: Session = {
    key: sessionKey,
    kind: 'ssh',
    ownerKey,
    serverId,
    remoteCwd,
    sid: randomUUID(),
    proc: null,
    connecting: null,
    status: 'exited',
    exitCode: null,
    screen,
    serializer,
    endsWithNewline: true,
    bytes: 0,
    parsedBytes: 0,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS
  }
  sessions.set(sessionKey, session)
  if (key === undefined) {
    void connectSshTerminal(session)
  } else {
    const name = findServer(serverId)?.name ?? '服务器'
    emitOutput(session, `\x1b[0m未连接。按回车连接到 ${name}\r\n`)
    emitStatus(session)
  }
  return sessionKey
}

/**
 * （重新）连接一个 SSH Terminal：经内置连接（ADR-0041）开 shell 通道，输出接着写在原有内容之后；
 * 断开后会话保留、提示按回车重连。
 */
async function connectSshTerminal(session: Session): Promise<void> {
  if (session.status === 'running') return
  // 标成连接中，挡住连按回车触发的重复连接
  session.status = 'running'
  session.exitCode = null
  emitStatus(session)
  const server = findServer(session.serverId!)
  if (!server) {
    endSession(session, '服务器已移除，无法连接', null)
    return
  }
  const command = session.remoteCwd === undefined ? null : buildRemoteShellInDir(session.remoteCwd)
  try {
    await openRemoteSession(session, server, command, (end) => {
      if ('reason' in end) {
        endSession(session, `连接已断开：${end.reason}。按回车重新连接`, null)
      } else if (end.exitCode === null) {
        endSession(session, '连接已断开。按回车重新连接', null)
      } else {
        endSession(session, `连接已断开，退出代码为 ${end.exitCode}。按回车重新连接`, end.exitCode)
      }
    })
  } catch (error) {
    // 连接期间 Tab 被关掉（服务器被移除也会关掉它）：什么都不做
    if (sessions.get(session.key) === session) {
      const message = error instanceof Error ? error.message : String(error)
      endSession(session, `${message}。按回车重新连接`, null)
    }
    return
  }
}

export function stop(key: string): void {
  const session = sessions.get(key)
  if (!session || session.status !== 'running') return
  killProcess(session, 'SIGTERM')
  setTimeout(() => {
    const s = sessions.get(key)
    if (s === session && s.status === 'running') killProcess(s, 'SIGKILL')
  }, 2000)
}

export function writeStdin(key: string, data: string): void {
  const session = sessions.get(key)
  if (!session) return
  // 未连接 / 已断开的 SSH Terminal：回车即（重新）连接，其余按键忽略
  if (session.kind === 'ssh' && session.status !== 'running') {
    if (data.includes('\r')) void connectSshTerminal(session)
    return
  }
  session.proc?.write(data)
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
      session.proc?.resize(cols, rows)
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

/**
 * 清空会话控制台输出：清无头终端屏幕、换代 sid、bytes 归零。
 * 进程与会话状态不变；换代是为了让渲染端丢弃清屏前的在途输出（bytes 跨代不可比）。
 */
export function clearSessionOutput(key: string): void {
  const s = sessions.get(key)
  if (!s) return
  s.screen.reset()
  s.sid = randomUUID()
  s.bytes = 0
  s.parsedBytes = 0
  s.endsWithNewline = true
}

export function getSessions(): SessionState[] {
  return [...sessions.values()].map(snapshot)
}

/** 退出闸用：含 kind，供区分 Run Session / Terminal / SSH Terminal。 */
export function getQuitGuardSessions(): QuitGuardSession[] {
  return [...sessions.values()].map((s) => ({ kind: s.kind, status: s.status }))
}

/**
 * 彻底销毁一个会话：在跑则先杀进程树，从 Map 移除，并通知渲染端清除其状态。
 * 用于配置被删除 / 对账移除 / 项目移除 —— 区别于用户「停止」（后者保留历史以便回看）。
 */
export function disposeSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  if (session.status === 'running') killProcess(session, 'SIGKILL')
  session.screen.dispose()
  sessions.delete(key)
  post(IPC.sessionRemoved, key)
}

/**
 * 用户关闭一个 Tab（Run Session 或 Terminal）：运行中则 SIGTERM 温和停止（2s 未退升级
 * SIGKILL——会话已出 Map，onExit 早退不会更新状态，故到点盲发、killProcess 自吞已退出的报错），
 * 并立即弃掉会话与输出。区别于 disposeSession 的立杀（那是删除/对账等非用户路径）。
 */
export function closeSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  if (session.status === 'running') {
    killProcess(session, 'SIGTERM')
    setTimeout(() => killProcess(session, 'SIGKILL'), 2000)
  }
  session.screen.dispose()
  sessions.delete(key)
  post(IPC.sessionRemoved, key)
}

/** 应用退出时清掉所有活跃进程树，避免 dev server 变孤儿。 */
export function killAllSessions(): void {
  for (const session of sessions.values()) {
    if (session.status === 'running') killProcess(session, 'SIGKILL')
  }
}
