// 服务器状态连接（Status Tab，见 docs/prd/server-status.md）：每台服务器至多一条，由主进程管理。
// 经内置连接（ADR-0041）在服务器上跑 STATUS_SCRIPT（exec 通道）；连上后每 2 秒往它的标准输入写一个换行
// 触发一帧，不管 Tab 是否可见——曲线因此连续。连接保留到手动断开、网络断开、服务器被编辑 / 移除或 DevCube 退出。

import type { Client, ClientChannel } from 'ssh2'
import { sshFailureMessage } from '../shared/server'
import {
  appendStatusHistory,
  computeStatusSample,
  createStatusStreamParser,
  parseStatusFrame,
  pruneStatusHistory,
  STATUS_INTERVAL_MS,
  STATUS_SCRIPT,
  type ServerStatusEvent,
  type ServerStatusState,
  type StatusFrame,
  type StatusPoint,
  type StatusScale,
  type StatusStreamEvent
} from '../shared/server-status'
import { buildRemoteStatusCommand } from './command'
import { findServer } from './servers'
import { connectSsh, onSshClosed } from './ssh-connect'

interface StatusConnection {
  state: ServerStatusState
  client: Client | null
  channel: ClientChannel | null
  /** 正在建立的连接：断开、编辑、移除时中止（撤下还没回答的提问） */
  connecting: AbortController | null
  timer: NodeJS.Timeout | null
  /** 换算常数（读基本信息时拿到） */
  scale: StatusScale | null
  /** 上一帧计数：算速率用 */
  prevFrame: StatusFrame | null
  /** 最近 5 分钟的曲线：手动断开后保留，重新连上还接得上；服务器被编辑时清空 */
  history: StatusPoint[]
  /** stderr 末尾：脚本出错退出时取最后一行作原因 */
  stderr: string
  /** 连接地址（本机 ssh 配置算出的 hostname），补进基本信息 */
  address: string
}

const IDLE: ServerStatusState = { phase: 'idle' }

const connections = new Map<string, StatusConnection>()
let sink: ((event: ServerStatusEvent) => void) | null = null

/** 状态变化推给谁：由 ipc 绑定到主窗口。 */
export function setServerStatusSink(next: (event: ServerStatusEvent) => void): void {
  sink = next
}

function connectionOf(serverId: string): StatusConnection {
  let conn = connections.get(serverId)
  if (!conn) {
    conn = {
      state: IDLE,
      client: null,
      channel: null,
      connecting: null,
      timer: null,
      scale: null,
      prevFrame: null,
      history: [],
      stderr: '',
      address: ''
    }
    connections.set(serverId, conn)
  }
  return conn
}

function setState(serverId: string, conn: StatusConnection, state: ServerStatusState): void {
  conn.state = state
  syncSampling(conn)
  sink?.({ serverId, state })
}

/** 已连上就定时取帧（开的时候先立即取一帧），否则停。 */
function syncSampling(conn: StatusConnection): void {
  const shouldRun = conn.state.phase === 'connected' && conn.channel !== null
  if (shouldRun && conn.timer === null) {
    const requestFrame = (): void => void conn.channel?.write('\n')
    requestFrame()
    conn.timer = setInterval(requestFrame, STATUS_INTERVAL_MS)
  } else if (!shouldRun && conn.timer !== null) {
    clearInterval(conn.timer)
    conn.timer = null
  }
}

export function getServerStatus(serverId: string): ServerStatusState {
  return connections.get(serverId)?.state ?? IDLE
}

function handleStreamEvent(
  serverId: string,
  conn: StatusConnection,
  event: StatusStreamEvent
): void {
  if (event.type === 'unsupported') {
    setState(serverId, conn, { phase: 'unsupported' })
  } else if (event.type === 'info') {
    conn.scale = event.scale
    conn.history = pruneStatusHistory(conn.history, Date.now())
    setState(serverId, conn, {
      phase: 'connected',
      info: { ...event.info, address: conn.address },
      sample: null,
      history: conn.history
    })
  } else if (conn.state.phase === 'connected' && conn.scale !== null) {
    const frame = parseStatusFrame(event.sections, conn.state.info, conn.scale)
    const sample = computeStatusSample(conn.prevFrame, frame, conn.scale)
    conn.prevFrame = frame
    conn.history = appendStatusHistory(conn.history, Date.now(), sample)
    setState(serverId, conn, { ...conn.state, sample, history: conn.history })
  }
}

/** 点「连接」/「重新连接」：连上服务器、跑状态脚本；已在连接或已连上则不动。 */
export async function connectServerStatus(serverId: string): Promise<void> {
  const conn = connectionOf(serverId)
  if (conn.state.phase === 'connecting' || conn.state.phase === 'connected') return
  const server = findServer(serverId)
  if (!server) return
  setState(serverId, conn, { phase: 'connecting' })
  const controller = new AbortController()
  conn.connecting = controller

  let client: Client
  let channel: ClientChannel
  try {
    const connection = await connectSsh({
      target: server.target,
      direct: server.direct,
      serverId,
      password: undefined,
      testing: false,
      signal: controller.signal
    })
    client = connection.client
    conn.address = connection.config.hostName
    channel = await new Promise<ClientChannel>((resolve, reject) =>
      client.exec(buildRemoteStatusCommand(STATUS_SCRIPT), (error, stream) =>
        error ? reject(error) : resolve(stream)
      )
    ).catch((error: Error) => {
      client.end()
      throw error
    })
  } catch (error) {
    if (conn.connecting !== controller) return
    conn.connecting = null
    const message = error instanceof Error ? error.message : String(error)
    setState(serverId, conn, { phase: 'disconnected', message })
    return
  }
  if (conn.connecting !== controller) {
    client.end()
    return
  }
  conn.connecting = null
  conn.client = client
  conn.channel = channel
  conn.scale = null
  conn.prevFrame = null
  conn.stderr = ''

  const parse = createStatusStreamParser()
  channel.setEncoding('utf8')
  channel.on('data', (chunk: string) => {
    if (conn.channel !== channel) return
    for (const event of parse(chunk)) handleStreamEvent(serverId, conn, event)
  })
  channel.stderr.setEncoding('utf8')
  channel.stderr.on('data', (chunk: string) => {
    conn.stderr = (conn.stderr + chunk).slice(-4000)
  })
  let exitCode: number | null = null
  channel.on('exit', (code: number | null) => {
    exitCode = code
  })
  // 脚本退出即断开连接
  channel.on('close', () => client.end())
  onSshClosed(client, (reason) => {
    if (conn.client !== client) return
    conn.client = null
    conn.channel = null
    // 不支持的系统：脚本给出标记后自行退出，停在「不支持」
    if (conn.state.phase === 'unsupported') {
      syncSampling(conn)
      return
    }
    const message = reason ?? sshFailureMessage(conn.stderr, exitCode)
    setState(serverId, conn, { phase: 'disconnected', message })
  })
}

/** 结束某台服务器的状态连接（不推送状态）。 */
function stopConnection(conn: StatusConnection): void {
  const client = conn.client
  conn.connecting?.abort()
  conn.connecting = null
  conn.client = null
  conn.channel = null
  conn.prevFrame = null
  syncSampling(conn)
  client?.end()
}

/** 点「断开」：结束连接、回到未连接；曲线保留，5 分钟内重新连上还接得上。 */
export function disconnectServerStatus(serverId: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  stopConnection(conn)
  setState(serverId, conn, IDLE)
}

/** 服务器被编辑：连接信息可能变了，断开并清空曲线。 */
export function resetServerStatus(serverId: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  stopConnection(conn)
  conn.history = []
  setState(serverId, conn, IDLE)
}

/** 服务器被移除：断开并忘掉它。 */
export function disposeServerStatus(serverId: string): void {
  const conn = connections.get(serverId)
  if (!conn) return
  stopConnection(conn)
  connections.delete(serverId)
}

/** 退出时一并结束（不计入退出确认）。 */
export function disposeAllServerStatus(): void {
  for (const serverId of [...connections.keys()]) disposeServerStatus(serverId)
}
