// ssh 提问的应答端（ADR-0038）：每次启动 ssh 都带上 SSH_ASKPASS + SSH_ASKPASS_REQUIRE=force，
// ssh 的所有提问（主机指纹确认、密码、私钥口令、验证码）都会执行 askpass 启动脚本 → 小助手
// （askpass-main.ts）→ 本模块的本地套接字。能用记住的密码作答就直接答，否则转给渲染端弹窗。
// 每次 ssh 启动一个一次性令牌：区分连接、限定记住的密码每次连接只用一次。

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server as NetServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  askpassAction,
  askpassRememberDefault,
  classifyAskpassPrompt,
  type AskpassPromptKind,
  type AskpassRequest,
  type AskpassResponse,
  type PasswordChange
} from '../shared/server'
import { passwordUnavailableReason, readSavedPassword, savePassword } from './server-secrets'

/** 小助手脚本：electron-vite 与主进程一起编译到 out/main；打包后在 asar 外（asarUnpack）才能被 Node 直接加载。 */
const HELPER_MAIN = join(__dirname, 'askpass.js').replace('app.asar', 'app.asar.unpacked')

/** askpass 启动脚本内容：以 Node 身份运行本应用自带的 Electron，执行小助手并透传提问。 */
export function askpassLauncherScript(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%DEVCUBE_ASKPASS_NODE%" "%DEVCUBE_ASKPASS_MAIN%" %*\r\n'
  }
  return '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$DEVCUBE_ASKPASS_NODE" "$DEVCUBE_ASKPASS_MAIN" "$@"\n'
}

interface Connection {
  /** 已登记的服务器；测试尚未保存的连接时为 null */
  serverId: string | null
  serverName: string
  /** 本次连接可自动作答的密码：记住的，或测试连接时表单里填的；没有为 null */
  password: string | null
  /** 本次连接是否已经用上面的密码答过一次 */
  usedSavedPassword: boolean
  /** 本次连接上一次回答密码提问时是否勾了「记住密码」；还没答过为 null */
  lastRemember: boolean | null
  /** 测试连接时的回调（见 AskpassConnectionOptions）；正常连接为 null */
  onTestPasswordFailure: ((rejected: boolean) => void) | null
}

/** 一次 ssh 连接的应答设置。 */
export interface AskpassConnectionOptions {
  serverId: string | null
  serverName: string
  /** 自动作答用的密码：沿用 serverId 记住的（undefined）/ 不自动作答（null）/ 用这个（测试连接时表单里填的） */
  password?: PasswordChange
  /**
   * 测试连接：只检验表单里的内容，密码提问不转给用户。给定的密码被拒（rejected）、或根本没有密码时
   * 调用它，由测试立即结束 ssh——不回答，ssh 就会以空密码再试，在服务器上白白多记失败次数。
   */
  onTestPasswordFailure?: (rejected: boolean) => void
}

interface Pending {
  socket: Socket
  token: string
  serverId: string | null
  kind: AskpassPromptKind
}

/** 提问怎么交给用户：由 ipc 绑定到主窗口（发请求 / 让过期的弹窗消失 / 通知记住了新密码）。 */
export interface AskpassSink {
  request(request: AskpassRequest): void
  dismiss(id: string): void
  passwordSaved(): void
}

const connections = new Map<string, Connection>()
const pending = new Map<string, Pending>()
let sink: AskpassSink | null = null
let started: Promise<{ handle: string; launcher: string } | null> | null = null
let netServer: NetServer | null = null
let socketFile: string | null = null

export function setAskpassSink(next: AskpassSink): void {
  sink = next
}

function reply(socket: Socket, answer: string | null): void {
  if (!socket.destroyed) socket.end(`${JSON.stringify({ answer })}\n`)
}

function handleQuestion(socket: Socket, token: string, prompt: string): void {
  const connection = connections.get(token)
  if (!connection || !sink) {
    reply(socket, null)
    return
  }
  const kind = classifyAskpassPrompt(prompt)
  const saved = connection.password
  const action = askpassAction(
    kind,
    saved !== null,
    connection.usedSavedPassword,
    connection.onTestPasswordFailure !== null
  )
  if (action === 'answer') {
    connection.usedSavedPassword = true
    reply(socket, saved)
    return
  }
  if (action === 'refuse') {
    // 先让测试结束 ssh，再回绝小助手，免得 ssh 抢先把空密码发出去
    connection.onTestPasswordFailure?.(connection.usedSavedPassword)
    reply(socket, null)
    return
  }
  const id = randomUUID()
  pending.set(id, { socket, token, serverId: connection.serverId, kind })
  // 连接中途结束（关掉 Tab、ssh 超时退出）时小助手随之退出，弹窗也要跟着消失
  socket.on('close', () => {
    if (pending.delete(id)) sink?.dismiss(id)
  })
  sink.request({
    id,
    serverName: connection.serverName,
    prompt,
    kind,
    canRemember:
      kind === 'password' && connection.serverId !== null && passwordUnavailableReason() === null,
    rememberDefault: askpassRememberDefault(connection.lastRemember, connection.usedSavedPassword),
    savedRejected: kind === 'password' && connection.usedSavedPassword
  })
}

function onSocket(socket: Socket): void {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    // 一条连接只问一个问题：拿到整行后不再读
    socket.removeAllListeners('data')
    try {
      const { token, prompt } = JSON.parse(line) as { token: unknown; prompt: unknown }
      if (typeof token !== 'string' || typeof prompt !== 'string') throw new Error('bad request')
      handleQuestion(socket, token, prompt)
    } catch {
      reply(socket, null)
    }
  })
}

/** 起本地套接字并写好启动脚本（进程内一次）；失败返回 null，ssh 退回在终端里提问。 */
function start(): Promise<{ handle: string; launcher: string } | null> {
  if (started) return started
  started = new Promise((resolvePromise) => {
    const handle =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\devcube-askpass-${randomUUID()}`
        : join(tmpdir(), `devcube-askpass-${randomUUID().slice(0, 8)}.sock`)
    let launcher: string
    try {
      const dir = join(app.getPath('userData'), 'askpass')
      mkdirSync(dir, { recursive: true })
      launcher = join(dir, process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh')
      writeFileSync(launcher, askpassLauncherScript(process.platform))
      if (process.platform !== 'win32') chmodSync(launcher, 0o755)
    } catch (error) {
      console.error('askpass: 无法写入启动脚本', error)
      resolvePromise(null)
      return
    }
    const server = createServer(onSocket)
    server.once('error', (error) => {
      console.error('askpass: 无法监听本地套接字', error)
      resolvePromise(null)
    })
    server.listen(handle, () => {
      netServer = server
      socketFile = process.platform === 'win32' ? null : handle
      resolvePromise({ handle, launcher })
    })
  })
  return started
}

/**
 * 为一次 ssh 启动登记连接，返回要并入 ssh 进程环境的变量；askpass 起不来时返回空对象
 * （ssh 退回在终端里提问，只是不能自动填记住的密码）。
 */
export async function beginAskpassConnection(
  token: string,
  options: AskpassConnectionOptions
): Promise<Record<string, string>> {
  const ready = await start()
  if (!ready) return {}
  const { serverId, serverName } = options
  connections.set(token, {
    serverId,
    serverName,
    password:
      options.password !== undefined
        ? options.password
        : serverId === null
          ? null
          : readSavedPassword(serverId),
    usedSavedPassword: false,
    lastRemember: null,
    onTestPasswordFailure: options.onTestPasswordFailure ?? null
  })
  return {
    SSH_ASKPASS: ready.launcher,
    SSH_ASKPASS_REQUIRE: 'force',
    DEVCUBE_ASKPASS_NODE: process.execPath,
    DEVCUBE_ASKPASS_MAIN: HELPER_MAIN,
    DEVCUBE_ASKPASS_HANDLE: ready.handle,
    DEVCUBE_ASKPASS_TOKEN: token
  }
}

/** ssh 已退出：注销连接，还在等回答的提问一并取消。 */
export function endAskpassConnection(token: string): void {
  connections.delete(token)
  for (const [id, p] of pending) {
    if (p.token !== token) continue
    pending.delete(id)
    reply(p.socket, null)
    sink?.dismiss(id)
  }
}

export function respondAskpass(response: AskpassResponse): void {
  const p = pending.get(response.id)
  if (!p) return
  pending.delete(response.id)
  if (response.answer !== null && p.kind === 'password') {
    // 密码错误后重问时沿用这次的勾选
    const connection = connections.get(p.token)
    if (connection) connection.lastRemember = response.remember
    if (response.remember && p.serverId) {
      savePassword(p.serverId, response.answer)
      sink?.passwordSaved()
    }
  }
  reply(p.socket, response.answer)
}

/** 退出时关掉套接字并删掉 socket 文件。 */
export function disposeAskpass(): void {
  netServer?.close()
  netServer = null
  if (socketFile) rmSync(socketFile, { force: true })
  socketFile = null
}
