// WSL 发行版的连接（ADR-0055、docs/prd/wsl-project.md）：每个发行版一条，启动发行版里的小助手（build/wsl），
// 经 JSON-RPC（vscode-jsonrpc，LSP 分帧）让它在发行版的登录环境里执行命令。进程与连接前检查由调用方注入。
import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import type { WslConnectionState } from '../shared/wsl'

/** 小助手进程（`wsl.exe … --exec ./devcube-wsl`）。 */
export interface WslHelperProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(): void
  /** 进程结束（含起不来）；起不来时带上原因 */
  exited: Promise<string | null>
}

export interface WslConnectionDeps {
  /** 连接前检查：连不上的原因，能连为 null（wsl-preflight） */
  preflight(distro: string): Promise<string | null>
  spawnHelper(distro: string): WslHelperProcess
  /** 等小助手初始化完成的上限 */
  timeoutMs: number
}

/** 小助手 initialize 的结果（同 build/wsl/server.go）。 */
export interface WslHelperInfo {
  /** 小助手在发行版里的绝对路径 */
  executable: string
  /** 用户的登录 shell（运行会话以它执行命令） */
  shell: string
  /** 运行会话登记进程组的目录（launch 子命令的 --run-dir） */
  runDir: string
}

export interface WslExecOptions {
  /** 发行版里的目录（Linux 路径） */
  cwd: string
  env?: Record<string, string>
  /** 写进标准输入后关闭 */
  input?: Buffer
  /** 给了即流式：输出按块回调，结果里不再带输出 */
  onData?: (fd: 'stdout' | 'stderr', chunk: Buffer) => void
  /** 取消即结束命令的整个进程组 */
  signal?: AbortSignal
}

/**
 * 与本机 git 子进程的结果同形（git-exec），永不 throw：连不上或进程起不来时 code 为 -1、error 写明原因；
 * 找不到可执行文件时 error.code 为 ENOENT（同 Node 的 spawn）。
 */
export interface WslExecResult {
  code: number
  stdout: Buffer
  stderr: Buffer
  error: Error | null
}

/** 发行版里的文件变化（同 @parcel/watcher 的事件；路径为 Linux 路径）。 */
export interface WslWatchEvent {
  path: string
  type: 'create' | 'update' | 'delete'
}

export type WslWatchListener = (err: Error | null, events: WslWatchEvent[]) => void

/** exec 的原始结果（同 build/wsl/exec.go，字节字段为 base64）。 */
interface RawExecResult {
  code: number
  stdout?: string
  stderr?: string
  error?: string
  notFound?: boolean
}

interface Live {
  helper: WslHelperProcess
  rpc: MessageConnection
  info: WslHelperInfo
}

/** 一个发行版：状态、连上后的连接、正在连的那一次（被 disconnect 打断即 abort，结束已起的小助手）。 */
interface Entry {
  /** 首次见到的写法（状态通知与提示用） */
  name: string
  state: WslConnectionState
  live: Live | null
  opening: { promise: Promise<Live>; controller: AbortController } | null
}

const DISCONNECTED: WslConnectionState = { status: 'disconnected' }
const EMPTY = Buffer.alloc(0)

/** 起不来时的原因：取 wsl.exe 或小助手报错的最后几行。 */
function startFailure(stderr: Buffer[], spawnError: string | null): string {
  const text = Buffer.concat(stderr).toString('utf8').trim().split(/\r?\n/).slice(-3).join(' ')
  return `WSL 启动失败：${text || spawnError || '未知原因'}`
}

export class WslConnections {
  /** 发行版名不分大小写（WSL 自己就不分），按小写做键 */
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(distro: string, state: WslConnectionState) => void>()
  private readonly dataListeners = new Map<string, NonNullable<WslExecOptions['onData']>>()
  private readonly watchListeners = new Map<string, WslWatchListener>()

  constructor(private readonly deps: WslConnectionDeps) {}

  state(distro: string): WslConnectionState {
    return this.entries.get(distro.toLowerCase())?.state ?? DISCONNECTED
  }

  onState(listener: (distro: string, state: WslConnectionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 连上（已连上或正在连则复用）。失败后保持失败状态与原因，直到 reconnect 或 disconnect——
   * 不在每次请求时重试，免得 Git Tab 每刷新一次就起一个 wsl.exe。
   */
  async connect(distro: string): Promise<WslHelperInfo> {
    return (await this.ensureLive(distro)).info
  }

  /** 清掉失败状态后重连（「重新连接」）。 */
  reconnect(distro: string): Promise<WslHelperInfo> {
    const entry = this.entryOf(distro)
    if (entry.state.status === 'failed') this.setState(entry, DISCONNECTED)
    return this.connect(distro)
  }

  /** 断开（含正在连的、清掉失败状态）：关掉小助手的输入并结束 wsl.exe，小助手随即退出并结束它起的进程。 */
  disconnect(distro: string): void {
    const entry = this.entries.get(distro.toLowerCase())
    if (!entry) return
    entry.opening?.controller.abort()
    entry.opening = null
    const live = entry.live
    if (live) {
      entry.live = null
      live.rpc.dispose()
      live.helper.kill()
    }
    if (entry.state.status !== 'disconnected') this.setState(entry, DISCONNECTED)
  }

  disconnectAll(): void {
    for (const entry of this.entries.values()) this.disconnect(entry.name)
  }

  /** 在发行版里执行一条命令（不经 shell）；必要时先连上。 */
  async exec(
    distro: string,
    file: string,
    args: readonly string[],
    options: WslExecOptions
  ): Promise<WslExecResult> {
    let live: Live
    try {
      live = await this.ensureLive(distro)
    } catch (e) {
      return { code: -1, stdout: EMPTY, stderr: EMPTY, error: e as Error }
    }
    const stream = options.onData ? randomUUID() : undefined
    if (stream && options.onData) this.dataListeners.set(stream, options.onData)
    const cancel = new CancellationTokenSource()
    const onAbort = (): void => cancel.cancel()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) cancel.cancel()
    try {
      const raw = await live.rpc.sendRequest<RawExecResult>(
        'exec',
        {
          file,
          args,
          cwd: options.cwd,
          env: options.env,
          stdin: options.input?.toString('base64'),
          stream
        },
        cancel.token
      )
      return {
        code: raw.code,
        stdout: raw.stdout ? Buffer.from(raw.stdout, 'base64') : EMPTY,
        stderr: raw.stderr ? Buffer.from(raw.stderr, 'base64') : EMPTY,
        error: raw.error
          ? Object.assign(new Error(raw.error), raw.notFound ? { code: 'ENOENT' } : {})
          : null
      }
    } catch (e) {
      return { code: -1, stdout: EMPTY, stderr: EMPTY, error: e as Error }
    } finally {
      if (stream) this.dataListeners.delete(stream)
      options.signal?.removeEventListener('abort', onAbort)
      cancel.dispose()
    }
  }

  /**
   * 给运行会话的整个进程组发信号（在发行版里结束，不靠结束 wsl.exe）；没连上、会话还没登记时返回 false，
   * 由调用方改为结束 wsl.exe。
   */
  async killRun(distro: string, id: string, signal: NodeJS.Signals): Promise<boolean> {
    const live = this.liveOf(distro)
    if (!live) return false
    try {
      await live.rpc.sendRequest('killRun', { id, signal })
      return true
    } catch {
      return false
    }
  }

  /** 运行会话结束：删掉它的登记，免得进程组号被复用后误伤。 */
  forgetRun(distro: string, id: string): void {
    void this.liveOf(distro)
      ?.rpc.sendNotification('forgetRun', { id })
      .catch(() => undefined)
  }

  /**
   * 递归监听发行版里的目录（Linux 路径）：事件按批回调（路径为 Linux 路径），出错（超出监听上限、事件溢出）时
   * 回调 err。需已连上；返回取消监听的函数。连接断开后监听随小助手一起没了，不再回调——由调用方按连接状态重建，
   * 不在断开时报错（报错会触发刷新、刷新又会把连接连回来，闲置断开就白做了）。
   */
  async watch(
    distro: string,
    root: string,
    listener: WslWatchListener
  ): Promise<() => Promise<void>> {
    const live = this.requireLive(distro)
    const id = randomUUID()
    this.watchListeners.set(id, listener)
    try {
      await live.rpc.sendRequest('watch', { id, root })
    } catch (e) {
      this.watchListeners.delete(id)
      throw e
    }
    return async () => {
      this.watchListeners.delete(id)
      if (this.liveOf(distro) !== live) return
      await live.rpc.sendRequest('unwatch', { id }).catch(() => undefined)
    }
  }

  /** 列出发行版里的目录（Linux 路径）；目录不存在时 notFound。需已连上。 */
  async readDir(distro: string, path: string): Promise<{ names: string[]; notFound: boolean }> {
    const r = await this.requireLive(distro).rpc.sendRequest<{
      names: string[]
      notFound?: boolean
    }>('readDir', { path })
    return { names: r.names, notFound: r.notFound === true }
  }

  /** 读发行版里的文件（Linux 路径）；不存在为 null。需已连上。 */
  async readFile(distro: string, path: string): Promise<Buffer | null> {
    const r = await this.requireLive(distro).rpc.sendRequest<{
      data?: string
      notFound?: boolean
    }>('readFile', { path })
    return r.notFound === true ? null : Buffer.from(r.data ?? '', 'base64')
  }

  private entryOf(distro: string): Entry {
    const key = distro.toLowerCase()
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { name: distro, state: DISCONNECTED, live: null, opening: null }
      this.entries.set(key, entry)
    }
    return entry
  }

  private liveOf(distro: string): Live | null {
    return this.entries.get(distro.toLowerCase())?.live ?? null
  }

  private requireLive(distro: string): Live {
    const live = this.liveOf(distro)
    if (!live) throw new Error(`尚未连接到 ${distro}`)
    return live
  }

  private ensureLive(distro: string): Promise<Live> {
    const entry = this.entryOf(distro)
    if (entry.live) return Promise.resolve(entry.live)
    if (entry.state.status === 'failed') return Promise.reject(new Error(entry.state.reason))
    if (!entry.opening) {
      const controller = new AbortController()
      const promise = this.open(entry, controller.signal).finally(() => {
        if (entry.opening?.controller === controller) entry.opening = null
      })
      entry.opening = { promise, controller }
    }
    return entry.opening.promise
  }

  private async open(entry: Entry, signal: AbortSignal): Promise<Live> {
    this.setState(entry, { status: 'connecting' })
    let helper: WslHelperProcess | null = null
    let rpc: MessageConnection | null = null
    try {
      const reason = await this.deps.preflight(entry.name)
      if (reason) throw new Error(reason)
      if (signal.aborted) throw new Error('aborted')
      const started = this.deps.spawnHelper(entry.name)
      helper = started
      signal.addEventListener('abort', () => started.kill(), { once: true })
      // 起不来时拿它说明原因；连上后不再收集（仍要读走，免得管道写满卡住小助手）
      const stderr: Buffer[] = []
      const collect = (chunk: Buffer): void => void stderr.push(chunk)
      started.stderr.on('data', collect)
      const connection = createMessageConnection(
        new StreamMessageReader(started.stdout),
        new StreamMessageWriter(started.stdin)
      )
      rpc = connection
      connection.onNotification('watch/events', (d: { id: string; events: WslWatchEvent[] }) =>
        this.watchListeners.get(d.id)?.(null, d.events)
      )
      connection.onNotification('watch/error', (d: { id: string; message: string }) =>
        this.watchListeners.get(d.id)?.(new Error(d.message), [])
      )
      connection.onNotification(
        'exec/data',
        (d: { stream: string; fd: 'stdout' | 'stderr'; data: string }) =>
          this.dataListeners.get(d.stream)?.(d.fd, Buffer.from(d.data, 'base64'))
      )
      connection.listen()
      // 初始化结果、进程退出、超时三者先到者为准（Promise 只结算一次，后到的自然忽略）
      const info = await new Promise<WslHelperInfo>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`连接 ${entry.name} 超时`)),
          this.deps.timeoutMs
        )
        connection
          .sendRequest<WslHelperInfo>('initialize')
          .then(resolve, reject)
          .finally(() => clearTimeout(timer))
        void started.exited.then((spawnError) => {
          clearTimeout(timer)
          reject(new Error(startFailure(stderr, spawnError)))
        })
      })
      if (signal.aborted) throw new Error('aborted')
      started.stderr.off('data', collect)
      started.stderr.resume()
      const live: Live = { helper: started, rpc: connection, info }
      entry.live = live
      void started.exited.then(() => this.onExited(entry, live))
      this.setState(entry, { status: 'connected' })
      return live
    } catch (e) {
      rpc?.dispose()
      helper?.kill()
      // 被 disconnect 打断的不算失败（状态已由 disconnect 置为未连接）
      if (!signal.aborted) this.setState(entry, { status: 'failed', reason: (e as Error).message })
      throw signal.aborted ? new Error(`与 ${entry.name} 的连接已断开`) : e
    }
  }

  /** 小助手退出：还是当前连接即为意外断开（主动断开时已先移出）。 */
  private onExited(entry: Entry, live: Live): void {
    if (entry.live !== live) return
    entry.live = null
    live.rpc.dispose()
    this.setState(entry, DISCONNECTED)
  }

  private setState(entry: Entry, state: WslConnectionState): void {
    entry.state = state
    for (const listener of this.listeners) listener(entry.name, state)
  }
}
