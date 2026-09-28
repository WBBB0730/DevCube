// 服务器状态连接（Status Tab，见 docs/prd/server-status.md）：每台服务器至多一条，由主进程管理。
// 经系统 ssh（ADR-0038）在服务器上跑 STATUS_SCRIPT；连上后每 2 秒往它的标准输入写一个换行触发一帧，
// 不管 Tab 是否可见——曲线因此连续。连接保留到手动断开、网络断开、服务器被编辑 / 移除或 DevCube 退出。

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { sshFailureMessage, sshStatusArgs } from '../shared/server'
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
import { beginAskpassConnection, endAskpassConnection } from './askpass'
import { buildRemoteStatusCommand } from './command'
import { findServer, prepareSsh, sshHostNameOf } from './servers'

interface StatusConnection {
  state: ServerStatusState
  child: ChildProcess | null
  /** 本次 ssh 的 askpass 令牌 */
  token: string | null
  timer: NodeJS.Timeout | null
  /** 换算常数（读基本信息时拿到） */
  scale: StatusScale | null
  /** 上一帧计数：算速率用 */
  prevFrame: StatusFrame | null
  /** 最近 5 分钟的曲线：手动断开后保留，重新连上还接得上；服务器被编辑时清空 */
  history: StatusPoint[]
  /** stderr 末尾：断开时取最后一行作原因 */
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
      child: null,
      token: null,
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
  const shouldRun = conn.state.phase === 'connected' && conn.child !== null
  if (shouldRun && conn.timer === null) {
    const requestFrame = (): void => void conn.child?.stdin?.write('\n')
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

/** 点「连接」/「重新连接」：起 ssh 跑状态脚本；已在连接或已连上则不动。 */
export async function connectServerStatus(serverId: string): Promise<void> {
  const conn = connectionOf(serverId)
  if (conn.state.phase === 'connecting' || conn.state.phase === 'connected') return
  const server = findServer(serverId)
  if (!server) return
  setState(serverId, conn, { phase: 'connecting' })
  const stillConnecting = (): boolean =>
    connections.get(serverId) === conn && conn.state.phase === 'connecting' && conn.child === null

  const prepared = await prepareSsh(server.target, server.direct)
  if (!stillConnecting()) return
  if ('failure' in prepared) {
    setState(serverId, conn, { phase: 'disconnected', message: prepared.failure })
    return
  }
  conn.address = await sshHostNameOf(prepared.ssh, prepared.env, server.target)
  if (!stillConnecting()) return
  const token = randomUUID()
  const askpassEnv = await beginAskpassConnection(token, {
    serverId,
    serverName: server.name
  })
  if (!stillConnecting()) {
    endAskpassConnection(token)
    return
  }

  let child: ChildProcess
  try {
    child = spawn(
      prepared.ssh,
      sshStatusArgs(server.target, buildRemoteStatusCommand(STATUS_SCRIPT), prepared.options),
      { cwd: homedir(), env: { ...prepared.env, ...askpassEnv }, windowsHide: true }
    )
  } catch (error) {
    endAskpassConnection(token)
    const reason = error instanceof Error ? error.message : String(error)
    setState(serverId, conn, { phase: 'disconnected', message: `无法启动 ssh：${reason}` })
    return
  }
  conn.child = child
  conn.token = token
  conn.scale = null
  conn.prevFrame = null
  conn.stderr = ''

  const parse = createStatusStreamParser()
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    if (conn.child !== child) return
    for (const event of parse(chunk)) handleStreamEvent(serverId, conn, event)
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    conn.stderr = (conn.stderr + chunk).slice(-4000)
  })
  // ssh 退出后还可能再写一次换行：吞掉 EPIPE
  child.stdin?.on('error', () => undefined)
  child.on('error', (error) => {
    conn.stderr += `\n无法启动 ssh：${error.message}`
  })
  child.on('close', (code) => {
    endAskpassConnection(token)
    if (conn.child !== child) return
    conn.child = null
    conn.token = null
    // 不支持的系统：脚本给出标记后自行退出，停在「不支持」
    if (conn.state.phase === 'unsupported') {
      syncSampling(conn)
      return
    }
    setState(serverId, conn, {
      phase: 'disconnected',
      message: sshFailureMessage(conn.stderr, code)
    })
  })
}

/** 结束某台服务器的状态连接（不推送状态）。 */
function stopConnection(conn: StatusConnection): void {
  const child = conn.child
  const token = conn.token
  conn.child = null
  conn.token = null
  conn.prevFrame = null
  syncSampling(conn)
  if (token !== null) endAskpassConnection(token)
  child?.kill()
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
