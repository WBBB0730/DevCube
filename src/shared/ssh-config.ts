// SSH 连接配置（docs/prd/ssh-connection.md、ADR-0041）：配置由系统 OpenSSH 解析（`ssh -G`），连接由 DevCube
// 内置的 ssh2 完成。这里把 `ssh -G` 的输出换算成连接要用的参数，并提供令牌展开、跳板机列表解析、算法取交集。

import { DEFAULT_SSH_PORT, type SshConfigHost } from './server'

export type StrictHostKeyChecking = 'yes' | 'ask' | 'accept-new' | 'no'

/** DevCube 支持的认证方式；GSSAPI 与 hostbased 不支持，按顺序时跳过。 */
export type SshAuthMethod = 'publickey' | 'keyboard-interactive' | 'password'

/** OpenSSH 默认的认证顺序（ssh_config(5) 的 PreferredAuthentications）。 */
const DEFAULT_AUTH_ORDER = 'gssapi-with-mic,hostbased,publickey,keyboard-interactive,password'

/** 一台主机（目标或跳板）的生效配置里，连接用到的部分。 */
export interface SshHostConfig {
  hostName: string
  port: number
  user: string
  /** IdentityFile 原样（`~` 与令牌未展开，`ssh -G` 不展开这一项），按配置顺序 */
  identityFiles: string[]
  identitiesOnly: boolean
  /** IdentityAgent：null 为未设置（用环境里的 SSH_AUTH_SOCK）；'none' 为不用 agent */
  identityAgent: string | null
  /** 认证顺序：PreferredAuthentications 去掉不支持的与关闭了的 */
  authMethods: SshAuthMethod[]
  numberOfPasswordPrompts: number
  batchMode: boolean
  strictHostKeyChecking: StrictHostKeyChecking
  userKnownHostsFiles: string[]
  globalKnownHostsFiles: string[]
  hashKnownHosts: boolean
  hostKeyAlias: string | null
  proxyJump: string | null
  /** ProxyCommand 原样（令牌未展开，`ssh -G` 不展开这一项） */
  proxyCommand: string | null
  bindAddress: string | null
  bindInterface: string | null
  addressFamily: 'any' | 'inet' | 'inet6'
  /** 秒；0 为不保活 */
  serverAliveInterval: number
  serverAliveCountMax: number
  /** 秒；null 为未设置 */
  connectTimeout: number | null
  kexAlgorithms: string[]
  hostKeyAlgorithms: string[]
  ciphers: string[]
  macs: string[]
  compression: boolean
  /** 配置了 CertificateFile（证书登录，DevCube 不支持；认证失败时点明） */
  hasCertificateFile: boolean
  /** SendEnv：要传给服务器的本机环境变量名的模式（`*` / `?` 通配） */
  sendEnv: string[]
  /** SetEnv：直接传给服务器的环境变量 */
  setEnv: Record<string, string>
  /** RemoteCommand：终端登录后执行它而不是登录 shell（`ssh -G` 已展开令牌） */
  remoteCommand: string | null
}

/** `ssh -G` 的输出按行拆成「小写键 值」，保留顺序与重复的键（IdentityFile 等可以有多行）。 */
function configLines(output: string): [string, string][] {
  const lines: [string, string][] = []
  for (const line of output.split(/\r?\n/)) {
    const space = line.indexOf(' ')
    if (space > 0) lines.push([line.slice(0, space), line.slice(space + 1).trim()])
  }
  return lines
}

/** `ssh -G` 的布尔值：no / false 为关，其余（yes、true，以及 PubkeyAuthentication 的 host-bound 等）为开。 */
function isOn(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value !== 'no' && value !== 'false'
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

function list(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(',').filter((s) => s !== '')
}

function strictOf(value: string | undefined): StrictHostKeyChecking {
  if (value === 'true' || value === 'yes') return 'yes'
  if (value === 'false' || value === 'no' || value === 'off') return 'no'
  if (value === 'accept-new') return 'accept-new'
  return 'ask'
}

/** 解析 `ssh -G` 的输出。缺的项按 OpenSSH 的缺省处理（`ssh -G` 实际总会给出 hostname、port、user）。 */
export function parseSshHostConfig(output: string): SshHostConfig {
  const lines = configLines(output)
  const first = new Map<string, string>()
  for (const [key, value] of lines) if (!first.has(key)) first.set(key, value)
  const all = (key: string): string[] => lines.filter(([k]) => k === key).map(([, v]) => v)
  const optional = (key: string): string | null => {
    const value = first.get(key)
    return value === undefined || value === 'none' ? null : value
  }
  const port = Number(first.get('port'))
  const enabled: Record<SshAuthMethod, boolean> = {
    publickey: isOn(first.get('pubkeyauthentication'), true),
    'keyboard-interactive': isOn(first.get('kbdinteractiveauthentication'), true),
    password: isOn(first.get('passwordauthentication'), true)
  }
  const authMethods = list(first.get('preferredauthentications') ?? DEFAULT_AUTH_ORDER).filter(
    (m): m is SshAuthMethod => m in enabled && enabled[m as SshAuthMethod]
  )
  const family = first.get('addressfamily')
  const connectTimeout = Number(first.get('connecttimeout'))
  return {
    hostName: first.get('hostname') ?? '',
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_SSH_PORT,
    user: first.get('user') ?? '',
    identityFiles: all('identityfile'),
    identitiesOnly: isOn(first.get('identitiesonly'), false),
    identityAgent: first.get('identityagent') ?? null,
    authMethods: [...new Set(authMethods)],
    numberOfPasswordPrompts: nonNegativeInt(first.get('numberofpasswordprompts'), 3),
    batchMode: isOn(first.get('batchmode'), false),
    strictHostKeyChecking: strictOf(first.get('stricthostkeychecking')),
    userKnownHostsFiles: all('userknownhostsfile').flatMap((v) => v.split(' ')),
    globalKnownHostsFiles: all('globalknownhostsfile').flatMap((v) => v.split(' ')),
    hashKnownHosts: isOn(first.get('hashknownhosts'), false),
    hostKeyAlias: optional('hostkeyalias'),
    proxyJump: optional('proxyjump'),
    proxyCommand: optional('proxycommand'),
    bindAddress: optional('bindaddress'),
    bindInterface: optional('bindinterface'),
    addressFamily: family === 'inet' || family === 'inet6' ? family : 'any',
    serverAliveInterval: nonNegativeInt(first.get('serveraliveinterval'), 0),
    serverAliveCountMax: nonNegativeInt(first.get('serveralivecountmax'), 3),
    connectTimeout: Number.isInteger(connectTimeout) && connectTimeout > 0 ? connectTimeout : null,
    kexAlgorithms: list(first.get('kexalgorithms')),
    hostKeyAlgorithms: list(first.get('hostkeyalgorithms')),
    ciphers: list(first.get('ciphers')),
    macs: list(first.get('macs')),
    // Compression yes 时 `ssh -G` 输出的是 UNKNOWN，只认 no 为关
    compression: first.has('compression') && first.get('compression') !== 'no',
    hasCertificateFile: first.has('certificatefile'),
    sendEnv: all('sendenv')
      .flatMap((v) => v.split(/\s+/))
      .filter((v) => v !== ''),
    setEnv: Object.fromEntries(
      all('setenv')
        .map((v) => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)])
        .filter(([name]) => name !== '')
    ),
    remoteCommand: optional('remotecommand')
  }
}

/** 添加服务器时列出的 `~/.ssh/config` 主机：`ssh -G <别名>` 的地址 / 用户 / 端口，读不到地址时显示别名。 */
export function parseSshConfigHost(alias: string, output: string): SshConfigHost {
  const { hostName, user, port } = parseSshHostConfig(output)
  return { alias, hostName: hostName || alias, user, port }
}

/**
 * 展开 ssh_config 的令牌（ssh_config(5) TOKENS）：`%%` 为 `%`，其余按 tokens 取值；遇到 tokens 里没有的
 * 令牌报错，同 OpenSSH。
 */
export function expandSshTokens(
  template: string,
  tokens: Readonly<Record<string, string>>
): string {
  return template.replace(/%(.?)/gs, (_, key: string) => {
    if (key === '%') return '%'
    const value = tokens[key]
    if (value === undefined) throw new Error(`ssh 配置里有无法识别的令牌 %${key}`)
    return value
  })
}

/** `~` 与 `~/…` 展开到用户目录；`~user` 这种写法原样返回。 */
export function expandTilde(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  return path
}

/** ProxyJump 的一跳：`[用户@]主机[:端口]` 或 `ssh://[用户@]主机[:端口]`；没写的项交给这一跳自己的配置。 */
export interface SshJumpHop {
  host: string
  user: string | null
  port: number | null
}

function parseJumpHop(spec: string): SshJumpHop {
  let rest = spec.startsWith('ssh://') ? spec.slice(6) : spec
  let user: string | null = null
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    user = rest.slice(0, at)
    rest = rest.slice(at + 1)
  }
  let host = rest
  let port: number | null = null
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest)
  if (bracketed) {
    host = bracketed[1]!
    port = bracketed[2] === undefined ? null : Number(bracketed[2])
  } else if (rest.split(':').length === 2) {
    // 只有一个冒号才是端口；不带方括号的 IPv6 地址有多个冒号
    const colon = rest.indexOf(':')
    host = rest.slice(0, colon)
    port = Number(rest.slice(colon + 1))
  }
  return { host, user, port }
}

/** 解析 ProxyJump 的值（逗号分隔，按连接顺序：第一个是离本机最近的跳板）。 */
export function parseProxyJump(value: string): SshJumpHop[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(parseJumpHop)
}

/** 跳板的 `ssh -G` 参数：写了用户、端口的用选项给出，其余按这一跳自己的配置。 */
export function jumpHopArgs(hop: SshJumpHop): string[] {
  const args: string[] = []
  if (hop.user !== null) args.push('-l', hop.user)
  if (hop.port !== null) args.push('-p', String(hop.port))
  args.push('--', hop.host)
  return args
}

/** `*` / `?` 通配的模式 → 正则（整串匹配）。 */
function wildcardPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

/**
 * 终端、服务器上的命令要传给服务器的环境变量（同 ssh）：本机环境里名字匹配 SendEnv 任一模式的，
 * 加上 SetEnv 的（同名以 SetEnv 为准）。服务器按自己的 AcceptEnv 取舍。
 */
export function sessionEnvOf(
  config: Pick<SshHostConfig, 'sendEnv' | 'setEnv'>,
  localEnv: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const patterns = config.sendEnv.map(wildcardPattern)
  const sent: Record<string, string> = {}
  for (const [name, value] of Object.entries(localEnv)) {
    if (value !== undefined && patterns.some((re) => re.test(name))) sent[name] = value
  }
  return { ...sent, ...config.setEnv }
}

/** 按名字精确匹配的规则。 */
function exactPattern(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

/**
 * 按用户配置的顺序指定算法：先清空 ssh2 的默认列表，再按顺序逐个追加。追加用规则而不用名字——
 * ssh2 对规则只挑它支持的（它文档里的 remove / append 用法），用户列表里它不支持的（如抗量子密钥交换）自然跳过。
 * 列表为空（`ssh -G` 没给）时为 undefined，用 ssh2 的默认列表。
 */
export function orderedAlgorithms(
  names: readonly string[]
): { remove: RegExp[]; append: RegExp[] } | undefined {
  if (names.length === 0) return undefined
  return { remove: [/.*/], append: names.map(exactPattern) }
}

/** 主机密钥类型对应的签名算法（RSA 密钥可用三种签名）。 */
function hostKeyAlgorithmsOf(keyType: string): string[] {
  return keyType === 'ssh-rsa' ? ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] : [keyType]
}

/**
 * 同 OpenSSH：known_hosts 里已有这台主机某些类型的密钥时，把这些类型排到最前，免得协商出另一种类型、
 * 又问一次「确定要继续连接吗」。其余保持原顺序。
 */
export function preferKnownHostKeyAlgorithms(
  algorithms: readonly string[],
  knownKeyTypes: readonly string[]
): string[] {
  const known = new Set(knownKeyTypes.flatMap(hostKeyAlgorithmsOf))
  return [...algorithms.filter((a) => known.has(a)), ...algorithms.filter((a) => !known.has(a))]
}
