// 内置 SSH 连接（ADR-0041、docs/prd/ssh-connection.md）：配置交给系统 OpenSSH 解析（`ssh -G`），连接、认证、
// 主机密钥核对、跳板机、代理命令、直连由 DevCube 用 ssh2 完成，语义同 OpenSSH。

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { connect as netConnect } from 'node:net'
import { existsSync } from 'node:fs'
import { homedir, hostname, networkInterfaces, userInfo } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { Duplex } from 'node:stream'
import { promisify } from 'node:util'
import {
  Client,
  createAgent,
  utils,
  type Algorithms,
  type AnyAuthMethod,
  type AuthenticationType,
  type BaseAgent,
  type ParsedKey,
  type Prompt
} from 'ssh2'
import {
  sshArgs,
  sshFailureMessage,
  supportsSshDirect,
  type PasswordChange,
  type ServerTarget
} from '../shared/server'
import {
  expandSshTokens,
  expandTilde,
  jumpHopArgs,
  orderedAlgorithms,
  parseProxyJump,
  parseSshHostConfig,
  preferKnownHostKeyAlgorithms,
  sessionEnvOf,
  type SshAuthMethod,
  type SshHostConfig,
  type SshJumpHop
} from '../shared/ssh-config'
import {
  hostKeyAction,
  hostKeyTypeLabel,
  isPasswordChallenge,
  rememberPasswordDefault,
  sshFailureReason,
  type SshFailure,
  type SshPrompt
} from '../shared/ssh-connect'
import { findOnPath, withTerminalLocale } from './command'
import {
  appendKnownHost,
  checkHostKey,
  findKnownHosts,
  formatKnownHostsLine,
  keyTypeOfBlob,
  knownHostsLookupName,
  knownKeyTypes,
  replaceKnownHost,
  sha256Fingerprint,
  type KnownHostEntry
} from './known-hosts'
import {
  passwordUnavailableReason,
  readSavedPassphrase,
  readSavedPassword,
  savePassphrase,
  savePassword
} from './server-secrets'
import { resolveShellEnvironment } from './shell-env'
import { directHostOf, resolveDirectRoute, usableIPv4Of } from './ssh-direct'
import { IdentityAgent } from './ssh-identities'
import { askSshPrompt, notifyPasswordSaved } from './ssh-prompts'

const execFileAsync = promisify(execFile)

const SSH_NOT_FOUND = '未找到 ssh，请安装 OpenSSH 客户端或将其加入 PATH'

/** ConnectTimeout 未设置时的连接超时（秒）：地址填错时不必干等系统的一分多钟。 */
const DEFAULT_CONNECT_TIMEOUT_S = 15

/** ServerAliveInterval 未设置时的保活间隔（秒），与连续无应答次数（ServerAliveCountMax）一起约 45 秒发现断网。 */
const DEFAULT_KEEPALIVE_S = 15

/** 登录 shell 环境里的 ssh（与用户终端里敲的是同一个）与该环境；找不到 ssh 时为 null。 */
export async function resolveSsh(): Promise<{ ssh: string | null; env: NodeJS.ProcessEnv }> {
  const env = withTerminalLocale({ ...process.env, ...(await resolveShellEnvironment()) })
  return { ssh: findOnPath('ssh', env), env }
}

/** `ssh -G <参数>`：ssh 自己算出的最终连接配置，与在终端里敲 ssh 时一致。 */
export async function sshConfigOutput(
  ssh: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[]
): Promise<string> {
  return (await execFileAsync(ssh, ['-G', ...args], { env, timeout: 5000 })).stdout
}

export interface SshConnectOptions {
  target: ServerTarget
  /** 绕开代理直连（ADR-0039）：只作用于目标本身；用户配置了跳板机、代理命令或绑定地址时不插手 */
  direct: boolean
  /** 已登记的服务器（用于记住密码）；测试尚未保存的连接时为 null */
  serverId: string | null
  /** 自动作答用的密码：沿用 serverId 记住的（undefined）/ 不自动作答（null）/ 用这个 */
  password: PasswordChange
  /** 测试连接：目标的密码只用上面那个答一次、不问用户；什么都不记住 */
  testing: boolean
  signal: AbortSignal
  /** 目标服务器在认证前发来的欢迎横幅（SSH Terminal 写进终端） */
  onBanner?: (message: string) => void
}

/** 一次连接的共同部分：ssh、同目录的 ssh-keygen 与登录 shell 环境、选项。 */
interface Session {
  ssh: string
  keygen: string
  env: NodeJS.ProcessEnv
  options: SshConnectOptions
  /** 调用方中止、或这次连接已有结果（成功或失败）时中止：还没回答的提问随之撤下 */
  signal: AbortSignal
}

/** 正在连接的一台主机（目标或某一跳）。 */
interface Hop {
  session: Session
  config: SshHostConfig
  /** 提问里写的 `用户@主机[:端口]` */
  destination: string
  /** 报错里写的 `主机[:端口]` */
  label: string
  /** 是目标本身（不是跳板）：记住的密码、测试连接的规则只对目标 */
  isTarget: boolean
  /** known_hosts 里核对用的名字（见 knownHostsLookupName） */
  hostKeyName: string
  /** known_hosts 里对上这台主机的记录 */
  knownHosts: KnownHostEntry[]
  tokens: Record<string, string>
}

/** 到一台主机的字节流；经跳板机时带上前一跳的连接，经代理命令时带上它的报错。 */
interface Transport {
  stream: Duplex
  via: Client | null
  /** 代理命令的报错（最后一行），连接失败时用 */
  proxyError: (() => string) | null
}

/** 认证通过的连接。 */
export interface SshConnection {
  client: Client
  /** 目标的生效配置（hostname 即状态页的连接地址；RemoteCommand 等终端要用） */
  config: SshHostConfig
  /** 终端与服务器上的命令要传的环境变量（按 SendEnv / SetEnv，见 sessionEnvOf） */
  sessionEnv: Record<string, string>
}

/**
 * 连到目标服务器，认证通过后返回 ssh2 的连接；经跳板机时，目标连接关闭即关掉各跳。
 * 失败时抛出的错误 message 是给用户看的完整说明；signal 中止时撤下提问、断开连接。
 */
export async function connectSsh(options: SshConnectOptions): Promise<SshConnection> {
  const { ssh, env } = await resolveSsh()
  if (ssh === null) throw new Error(SSH_NOT_FOUND)
  // 与 ssh 同一目录、同一套安装的 ssh-keygen，版本一致
  const keygen = join(dirname(ssh), process.platform === 'win32' ? 'ssh-keygen.exe' : 'ssh-keygen')
  if (!existsSync(keygen)) throw new Error(`未找到 ssh-keygen（应与 ${ssh} 在同一目录）`)
  // 连接中途结束（如服务器等不及回答、断开了）时，还在等回答的提问不能留在屏幕上
  const settled = new AbortController()
  const signal = AbortSignal.any([options.signal, settled.signal])
  try {
    const session = { ssh, keygen, env, options, signal }
    const { client, config } = await openHost(session, sshArgs(options.target), true, undefined)
    return { client, config, sessionEnv: sessionEnvOf(config, env) }
  } finally {
    settled.abort()
  }
}

/**
 * 连接关闭时回调原因：意外断开（保活无应答、网络错误）为中文原因，正常断开为 null。连上后即调用。
 */
export function onSshClosed(client: Client, handler: (reason: string | null) => void): void {
  let failure: SshFailure | null = null
  client.on('error', (error: Error & { code?: string }) => {
    failure ??= error
  })
  client.once('close', () => handler(failure === null ? null : sshFailureReason(failure)))
}

function portSuffix(port: number): string {
  return port === 22 ? '' : `:${port}`
}

/** 令牌的取值（ssh_config(5) TOKENS）；originalHost 为命令行上给的名字（%n）。 */
function tokensOf(config: SshHostConfig, originalHost: string): Record<string, string> {
  const local = hostname()
  const { uid, username } = userInfo()
  const jumps = config.proxyJump ?? ''
  return {
    C: createHash('sha1')
      .update(`${local}${config.hostName}${config.port}${config.user}${jumps}`)
      .digest('hex'),
    d: homedir(),
    h: config.hostName,
    i: String(uid),
    j: jumps,
    k: config.hostKeyAlias ?? originalHost,
    L: local.split('.')[0]!,
    l: local,
    n: originalHost,
    p: String(config.port),
    r: config.user,
    u: username
  }
}

/**
 * 按 `ssh -G` 的参数连上一台主机，返回连接与它的生效配置；jumps 为经哪些跳板（undefined 时按这台主机
 * 自己的配置）。
 */
async function openHost(
  session: Session,
  args: string[],
  isTarget: boolean,
  jumps: SshJumpHop[] | undefined
): Promise<{ client: Client; config: SshHostConfig }> {
  const { ssh, env } = session
  let output: string
  try {
    output = await sshConfigOutput(ssh, env, args)
  } catch (error) {
    const { code, stderr } = error as NodeJS.ErrnoException & { stderr?: string }
    throw new Error(sshFailureMessage(stderr ?? '', typeof code === 'number' ? code : null))
  }
  session.signal.throwIfAborted()
  const config = parseSshHostConfig(output)
  const hostKeyName = knownHostsLookupName(config.hostKeyAlias ?? config.hostName, config.port)
  const knownHostsFiles = [...config.userKnownHostsFiles, ...config.globalKnownHostsFiles]
  const hop: Hop = {
    session,
    config,
    destination: `${config.user}@${config.hostName}${portSuffix(config.port)}`,
    label: `${config.hostName}${portSuffix(config.port)}`,
    isTarget,
    hostKeyName,
    knownHosts: await findKnownHosts(
      session.keygen,
      knownHostsFiles.map((f) => expandTilde(f, homedir())),
      hostKeyName
    ),
    tokens: tokensOf(config, args[args.length - 1]!)
  }
  const algorithms = algorithmsOf(hop)
  const transport = await openTransport(hop, jumps)
  try {
    const client = await handshake(hop, transport, algorithms)
    if (transport.via !== null) client.once('close', () => transport.via!.end())
    return { client, config }
  } catch (error) {
    transport.via?.end()
    throw error
  }
}

/** 到这台主机的字节流：经跳板机的转发通道、代理命令的标准输入输出，或直接的 TCP 连接。 */
async function openTransport(hop: Hop, jumps: SshJumpHop[] | undefined): Promise<Transport> {
  const { config, session } = hop
  const route = jumps ?? (config.proxyJump === null ? [] : parseProxyJump(config.proxyJump))
  if (route.length > 0) {
    const last = route[route.length - 1]!
    const { client: via } = await openHost(
      session,
      jumpHopArgs(last),
      false,
      route.length > 1 ? route.slice(0, -1) : undefined
    )
    try {
      const stream = await forwardTo(via, config.hostName, config.port, last.host)
      return { stream, via, proxyError: null }
    } catch (error) {
      via.end()
      throw error
    }
  }
  if (jumps === undefined && config.proxyCommand !== null) {
    return runProxyCommand(hop, config.proxyCommand)
  }
  return { stream: await connectTcp(hop), via: null, proxyError: null }
}

function forwardTo(via: Client, host: string, port: number, jumpHost: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    via.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
      if (error)
        reject(
          new Error(`跳板机 ${jumpHost} 无法连接到 ${host}${portSuffix(port)}：${error.message}`)
        )
      else resolve(channel)
    })
  })
}

/** 同 OpenSSH：用用户的 shell 以 exec 执行代理命令，以它的标准输入输出作为连接。 */
function runProxyCommand(hop: Hop, template: string): Transport {
  const { env } = hop.session
  const command = expandSshTokens(template, hop.tokens)
  const child =
    process.platform === 'win32'
      ? spawn(command, { env, shell: true, windowsHide: true })
      : spawn(env.SHELL || '/bin/sh', ['-c', `exec ${command}`], { env })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)))
  child.on('error', (error) => (stderr += `\n无法执行代理命令：${error.message}`))
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin })
  stream.once('close', () => child.kill())
  return { stream, via: null, proxyError: () => sshFailureMessage(stderr, child.exitCode) }
}

/** TCP 连接：用户配置了 BindAddress / BindInterface 时从那里出去；直连时走实体网卡与真实地址。 */
async function connectTcp(hop: Hop): Promise<Duplex> {
  const { config, session } = hop
  let host = config.hostName
  let localAddress = config.bindAddress ?? undefined
  if (config.bindInterface !== null) {
    localAddress = usableIPv4Of(networkInterfaces()[config.bindInterface]) ?? undefined
    if (localAddress === undefined) {
      throw new Error(`无法连接到 ${hop.label}：网卡 ${config.bindInterface} 没有可用的地址`)
    }
  }
  const directHost =
    hop.isTarget && session.options.direct && supportsSshDirect(process.platform)
      ? directHostOf(config)
      : null
  if (directHost !== null) {
    const route = await resolveDirectRoute(directHost)
    if ('failure' in route) throw new Error(route.failure)
    localAddress = route.localAddress
    host = route.realAddress ?? host
  }
  const timeoutMs = (config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_S) * 1000
  const { signal } = session
  return new Promise((resolve, reject) => {
    const socket = netConnect({
      host,
      port: config.port,
      localAddress,
      family: config.addressFamily === 'inet' ? 4 : config.addressFamily === 'inet6' ? 6 : 0
    })
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      return true
    }
    const fail = (failure: SshFailure): void => {
      if (!settle()) return
      socket.destroy()
      reject(new Error(`无法连接到 ${hop.label}：${sshFailureReason(failure)}`))
    }
    const timer = setTimeout(() => fail({ code: 'ETIMEDOUT', message: 'timeout' }), timeoutMs)
    const onAbort = (): void => fail({ message: '已取消' })
    signal.addEventListener('abort', onAbort, { once: true })
    // 连上之后的错误由 ssh2 处理；这个监听留着，免得交接的间隙里出错没人接
    socket.on('error', (error: NodeJS.ErrnoException) => fail(error))
    socket.once('connect', () => {
      if (settle()) resolve(socket)
    })
  })
}

/**
 * 按 ssh 配置里的顺序指定算法（见 orderedAlgorithms）。ssh2 文档写明 remove / append 可以用规则，
 * 它的类型定义漏了这种写法，所以这里转一下类型。
 */
function algorithmsOf(hop: Hop): Algorithms {
  const { config } = hop
  const hostKeys = preferKnownHostKeyAlgorithms(
    config.hostKeyAlgorithms,
    knownKeyTypes(hop.knownHosts)
  )
  return {
    kex: orderedAlgorithms(config.kexAlgorithms),
    serverHostKey: orderedAlgorithms(hostKeys),
    cipher: orderedAlgorithms(config.ciphers),
    hmac: orderedAlgorithms(config.macs),
    compress: config.compression ? ['zlib@openssh.com', 'zlib', 'none'] : ['none']
  } as Algorithms
}

/** ssh2 的 authHandler 回调：给出下一种认证方式，或 false 表示没有可试的了（类型定义里漏了 false）。 */
type NextAuth = (next: AnyAuthMethod | false) => void

/** 在字节流上完成 SSH 握手、主机密钥核对与认证。 */
function handshake(hop: Hop, transport: Transport, algorithms: Algorithms): Promise<Client> {
  const { config, session } = hop
  const { signal } = session
  const auth = new Authenticator(hop)
  let hostKeyReason: string | null = null
  return new Promise((resolve, reject) => {
    const client = new Client()
    let failure: SshFailure | null = null
    let ready = false
    // 连接超时管到服务器亮出主机密钥为止；之后是用户回答提问，不计时（服务器自己有登录时限）。
    // 超时与取消都直接断开（destroy）：对方不回话时，end 等不到它关闭。
    const timer = setTimeout(
      () => {
        failure = { code: 'ETIMEDOUT', message: 'timeout' }
        client.destroy()
      },
      (config.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_S) * 1000
    )
    const onAbort = (): void => {
      client.destroy()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (hop.isTarget && session.options.onBanner) client.on('banner', session.options.onBanner)
    client.on('error', (error: Error & { level?: string; code?: string }) => {
      // 某把密钥签名失败（放弃了口令等）：ssh2 接着试下一把，不算连接失败
      if (error.level !== 'agent') failure ??= error
    })
    client.once('ready', () => {
      ready = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      auth.succeeded()
      resolve(client)
    })
    client.once('close', () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (ready) return
      const reason = signal.aborted
        ? '已取消'
        : (hostKeyReason ??
          auth.failureReason(failure) ??
          transport.proxyError?.() ??
          sshFailureReason(failure ?? { message: '连接已断开' }))
      reject(new Error(`无法连接到 ${hop.label}：${reason}`))
    })
    client.connect({
      sock: transport.stream,
      username: config.user,
      readyTimeout: 0,
      keepaliveInterval: (config.serverAliveInterval || DEFAULT_KEEPALIVE_S) * 1000,
      keepaliveCountMax: config.serverAliveCountMax,
      algorithms,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        clearTimeout(timer)
        verifyHostKey(hop, key, auth).then(
          (result) => {
            hostKeyReason = result === true ? null : result
            verify(result === true)
          },
          () => verify(false)
        )
      },
      authHandler: (methodsLeft: AuthenticationType[] | null, _partial: boolean | null, next) =>
        void auth.next(methodsLeft).then(next as NextAuth, () => (next as NextAuth)(false))
    })
  })
}

/** 核对主机密钥；放行为 true，否则为拒绝的原因。 */
async function verifyHostKey(hop: Hop, blob: Buffer, auth: Authenticator): Promise<true | string> {
  const { config, session, hostKeyName: name } = hop
  const keyType = keyTypeOfBlob(blob)
  const key = blob.toString('base64')
  const userFiles = config.userKnownHostsFiles.map((f) => expandTilde(f, homedir()))
  const check = checkHostKey(hop.knownHosts, keyType, key)
  let action = hostKeyAction(config.strictHostKeyChecking, check.status, config.batchMode)
  // 旧记录在系统的 known_hosts 里（没有写权限）时改不了，同 OpenSSH 拒绝
  if (action === 'confirm-changed' && !check.stale.every((e) => userFiles.includes(e.file))) {
    action = 'refuse'
  }
  const line = (): string => formatKnownHostsLine(name, keyType, key, config.hashKnownHosts)
  // 写不进 known_hosts 不挡连接，同 OpenSSH（它只打一行警告）
  const add = (): Promise<void> => appendKnownHost(userFiles[0]!, line()).catch(() => undefined)
  const shown = {
    host: name,
    keyType: hostKeyTypeLabel(keyType),
    fingerprint: sha256Fingerprint(blob)
  }
  switch (action) {
    case 'accept':
      return true
    case 'accept-once':
      auth.restrict()
      return true
    case 'add':
      await add()
      return true
    case 'confirm-new': {
      const answer = await askSshPrompt(
        hop.destination,
        { kind: 'host-unknown', ...shown },
        session.signal
      )
      if (answer === null) return '已取消'
      await add()
      return true
    }
    case 'confirm-changed': {
      const prompt: SshPrompt = {
        kind: 'host-changed',
        ...shown,
        knownHostsFile: check.stale[0]!.file
      }
      const answer = await askSshPrompt(hop.destination, prompt, session.signal)
      if (answer === null) return '已取消'
      await replaceKnownHost(session.keygen, check.stale, name, userFiles[0]!, line())
      return true
    }
    case 'refuse':
      if (check.status === 'revoked') return '主机密钥核对失败：这把密钥已被吊销'
      if (check.status === 'changed') return '主机密钥核对失败：与 known_hosts 里的记录不符'
      return '主机密钥核对失败：known_hosts 里没有这台主机'
  }
}

/**
 * 认证：按 PreferredAuthentications 的顺序逐个试，服务器返回「部分成功」时按它给的剩余方式接着试（多步认证）。
 * 密码与交互式认证合计最多问 NumberOfPasswordPrompts 次；BatchMode 下不问。
 */
class Authenticator {
  private methods: SshAuthMethod[]
  private readonly identities: IdentityAgent
  private passwordAttempts = 0
  private challengeAttempts = 0
  private challengeDone = false
  private initialUsed = false
  private lastRemember: boolean | null = null
  /** 用户输入并勾了「记住密码」的密码：认证通过后才记住 */
  private toRemember: string | null = null
  /** 认证失败的具体原因（测试连接没有密码等） */
  private reason: string | null = null
  /** 目标的自动作答密码（记住的，或测试连接时表单里的） */
  private readonly initial: string | null

  constructor(private readonly hop: Hop) {
    const { config, isTarget, session } = hop
    const { options } = session
    this.methods = [...config.authMethods]
    this.initial = !isTarget
      ? null
      : options.password !== undefined
        ? options.password
        : options.serverId === null
          ? null
          : readSavedPassword(options.serverId)
    this.identities = new IdentityAgent({
      agent: agentOf(config, session.env),
      files: config.identityFiles.map((f) =>
        resolvePath(homedir(), expandSshTokens(expandTilde(f, homedir()), hop.tokens))
      ),
      identitiesOnly: config.identitiesOnly,
      unlock: (file, raw) => this.unlock(file, raw)
    })
  }

  /** StrictHostKeyChecking no 放行了已更改的主机密钥：这次只用公钥认证，同 OpenSSH。 */
  restrict(): void {
    this.methods = this.methods.filter((m) => m === 'publickey')
  }

  async next(methodsLeft: AuthenticationType[] | null): Promise<AnyAuthMethod | false> {
    const username = this.hop.config.user
    // 先以 none 问出服务器接受哪些方式，同 OpenSSH
    if (methodsLeft === null) return { type: 'none', username }
    while (this.methods.length > 0) {
      const method = this.methods[0]!
      if (methodsLeft.includes(method)) {
        if (method === 'publickey') {
          this.methods.shift()
          return { type: 'agent', username, agent: this.identities }
        }
        if (method === 'password') {
          const password = await this.password()
          if (password !== null) return { type: 'password', username, password }
        } else if (
          !this.challengeDone &&
          this.challengeAttempts < this.hop.config.numberOfPasswordPrompts
        ) {
          this.challengeAttempts++
          return {
            type: 'keyboard-interactive',
            username,
            prompt: (name, instructions, _lang, prompts, finish) =>
              void this.answerChallenge(name, instructions, prompts).then(finish)
          }
        }
      }
      this.methods.shift()
    }
    return false
  }

  /** 认证通过：记住用户勾了「记住密码」的密码。 */
  succeeded(): void {
    const { serverId, testing } = this.hop.session.options
    if (this.toRemember === null || serverId === null || testing) return
    savePassword(serverId, this.toRemember)
    notifyPasswordSaved()
  }

  /** 认证失败时的说法：有具体原因用它；只有不支持的密钥可用时点明。其余情形为 null。 */
  failureReason(failure: SshFailure | null): string | null {
    if (this.reason !== null) return this.reason
    if (failure?.message !== 'All configured authentication methods failed') return null
    const unsupported = this.identities.unsupported || this.hop.config.hasCertificateFile
    return unsupported ? '认证失败；DevCube 不支持硬件密钥与证书登录' : '认证失败'
  }

  private canRememberPassword(): boolean {
    const { serverId, testing } = this.hop.session.options
    return (
      this.hop.isTarget && !testing && serverId !== null && passwordUnavailableReason() === null
    )
  }

  /** 下一次尝试用的密码；没有可用的（次数用完、测试连接不问、用户取消、BatchMode）为 null。 */
  private async password(): Promise<string | null> {
    const { config, isTarget, destination, session } = this.hop
    if (this.passwordAttempts >= config.numberOfPasswordPrompts) return null
    const rejected = this.passwordAttempts > 0
    this.passwordAttempts++
    if (this.initial !== null && !this.initialUsed) {
      this.initialUsed = true
      return this.initial
    }
    if (isTarget && session.options.testing) {
      // 测试连接只检验表单里的内容：不向用户要密码，就此结束认证
      this.reason = rejected ? '密码错误' : '服务器要求输入密码，请先填写后再测试'
      this.methods = []
      return null
    }
    if (config.batchMode) return null
    const answer = await askSshPrompt(
      destination,
      {
        kind: 'password',
        canRemember: this.canRememberPassword(),
        rememberDefault: rememberPasswordDefault(this.lastRemember, this.initialUsed),
        rejected
      },
      session.signal
    )
    if (answer === null) return null
    const value = answer.answers[0] ?? ''
    this.lastRemember = answer.remember
    this.toRemember = answer.remember ? value : null
    return value
  }

  private async answerChallenge(
    name: string,
    instructions: string,
    prompts: Prompt[]
  ): Promise<string[]> {
    const items = prompts.map((p) => ({ prompt: p.prompt, echo: p.echo === true }))
    if (items.length === 0) return []
    if (isPasswordChallenge(items)) {
      const password = await this.password()
      if (password === null) this.challengeDone = true
      return password === null ? [] : [password]
    }
    if (this.hop.config.batchMode) {
      this.challengeDone = true
      return []
    }
    const answer = await askSshPrompt(
      this.hop.destination,
      { kind: 'challenge', name, instructions, prompts: items },
      this.hop.session.signal
    )
    if (answer === null) {
      this.challengeDone = true
      return []
    }
    return answer.answers
  }

  /** 解密加了口令的私钥：先试记住的口令，不对或没有时问用户（最多 NumberOfPasswordPrompts 次）。 */
  private async unlock(file: string, raw: Buffer): Promise<ParsedKey | null> {
    const { config, destination, session } = this.hop
    const { signal } = session
    const { testing } = session.options
    const saved = readSavedPassphrase(file)
    if (saved !== null) {
      const key = utils.parseKey(raw, saved)
      if (!(key instanceof Error)) return key
    }
    if (config.batchMode) return null
    const canRemember = !testing && passwordUnavailableReason() === null
    for (let attempt = 0; attempt < config.numberOfPasswordPrompts; attempt++) {
      const answer = await askSshPrompt(
        destination,
        { kind: 'passphrase', keyFile: file, canRemember, rejected: attempt > 0 || saved !== null },
        signal
      )
      if (answer === null) return null
      const passphrase = answer.answers[0] ?? ''
      const key = utils.parseKey(raw, passphrase)
      if (key instanceof Error) continue
      if (answer.remember && canRemember) savePassphrase(file, passphrase)
      return key
    }
    return null
  }
}

/**
 * ssh-agent：IdentityAgent none 不用；指定了路径（或 `$变量`）用它；否则用登录 shell 环境里的
 * SSH_AUTH_SOCK；Windows 上都没有时用 OpenSSH 自带 agent 的命名管道。
 */
function agentOf(config: SshHostConfig, env: NodeJS.ProcessEnv): BaseAgent | null {
  const setting = config.identityAgent
  if (setting === 'none') return null
  let path: string | undefined
  if (setting === null || setting === 'SSH_AUTH_SOCK') path = env.SSH_AUTH_SOCK
  else if (setting.startsWith('$')) path = env[setting.slice(1)]
  else path = expandTilde(setting, homedir())
  if (!path && process.platform === 'win32') path = '\\\\.\\pipe\\openssh-ssh-agent'
  return path ? createAgent(path) : null
}
