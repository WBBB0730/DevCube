// 服务器（Server）与 SSH 终端（SSH Terminal）的域模型与纯函数；术语见 CONTEXT.md，
// 取舍见 ADR-0038（一律经系统 OpenSSH，DevCube 只拼参数、回答提问，不实现协议）。

import type { RemoteRunConfig } from './types'

/** 连接目标：引用 `~/.ssh/config` 的一个主机别名，或手填的地址 / 用户 / 端口 / 私钥。 */
export type ServerTarget =
  | { kind: 'config'; alias: string }
  | {
      kind: 'manual'
      host: string
      /** 空串 = 不指定，交给 ssh 按本机用户名 */
      user: string
      port: number
      /** 私钥文件绝对路径；缺省交给 ssh 的默认规则 */
      identityFile?: string
    }

/** 被登记进 DevCube 的一台远程主机（左树里与 Project 并列的顶层条目）。 */
export interface Server {
  id: string
  /** 展示名；默认由连接目标派生，可改 */
  name: string
  target: ServerTarget
  /** 登记时间（epoch ms） */
  addedAt: number
  /** 最近打开时间（epoch ms）；登记时写入，之后每次选中刷新 */
  lastOpenedAt: number | null
  pinned: boolean
  /** 左树自定义序（与 Project 共用一条序列，小的在前） */
  order: number
  /** 绕开代理直连（ADR-0039）：连接时从实体网卡出去，不经 TUN 代理；只在 macOS / Windows 生效 */
  direct: boolean
}

/** 渲染端看到的服务器：密文只留在主进程，这里只带「是否记住了密码」。 */
export interface ServerNode {
  server: Server
  hasPassword: boolean
  /** 在这台服务器上执行的命令型配置（按用户排的顺序） */
  configs: RemoteRunConfig[]
}

/**
 * 表单对记住的密码的处理（保存与测试连接共用同一种写法）：
 * undefined = 不动，沿用记住的；null = 不要记住的密码（清除）；字符串 = 换成这个。
 */
export type PasswordChange = string | null | undefined

/** 添加 / 编辑服务器的提交内容。 */
export interface ServerInput {
  name: string
  target: ServerTarget
  password?: PasswordChange
  direct: boolean
}

/** `~/.ssh/config` 里可选的一个主机（按 `ssh -G` 解析出的实际连接信息展示）。 */
export interface SshConfigHost {
  alias: string
  hostName: string
  user: string
  port: number
}

/** 测试连接的输入：表单当前的连接目标与密码处理（undefined 时沿用 serverId 记住的密码）。 */
export interface ServerTestInput {
  target: ServerTarget
  /** 编辑已登记的服务器时为其 id，添加时为 null */
  serverId: string | null
  name: string
  password: PasswordChange
  direct: boolean
}

export type ServerTestResult =
  { status: 'ok' } | { status: 'failed'; message: string } | { status: 'canceled' }

/** ssh 交给 DevCube 回答的一次提问的类型：是否确认 / 密码 / 其他需保密的输入（口令、验证码）。 */
export type AskpassPromptKind = 'confirm' | 'password' | 'secret'

/** 主进程 → 渲染端：请用户回答 ssh 的一次提问。 */
export interface AskpassRequest {
  id: string
  serverName: string
  /** ssh 给出的提问原文 */
  prompt: string
  kind: AskpassPromptKind
  /** 可以勾选「记住密码」 */
  canRemember: boolean
  /** 「记住密码」的初始勾选（见 askpassRememberDefault） */
  rememberDefault: boolean
  /** 自动填入的记住的密码刚被服务器拒绝 */
  savedRejected: boolean
}

/** 渲染端 → 主进程：用户的回答；answer 为 null 表示取消。 */
export interface AskpassResponse {
  id: string
  answer: string | null
  remember: boolean
}

export const DEFAULT_SSH_PORT = 22

/** 连接目标的一行说明：别名原样；手填为 `用户@地址` 或 `地址`，非默认端口追加 `:端口`。 */
export function serverTargetLabel(target: ServerTarget): string {
  if (target.kind === 'config') return target.alias
  const base = target.user === '' ? target.host : `${target.user}@${target.host}`
  return target.port === DEFAULT_SSH_PORT ? base : `${base}:${target.port}`
}

/** 绕开代理直连只在 macOS / Windows 提供：Linux 按目标地址选路，普通进程绕不开 TUN（ADR-0039）。 */
export function supportsSshDirect(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * 启动 ssh 的参数。以 `--` 结束选项，目标不会被当成选项解析；
 * 手填目标的端口 / 私钥用命令行选项给出，其余仍走 ssh 的默认规则与 `~/.ssh/config`。
 * options 是额外的 ssh 选项（如直连追加的 `-o …`），排在最前。
 */
export function sshArgs(target: ServerTarget, options: readonly string[] = []): string[] {
  if (target.kind === 'config') return [...options, '--', target.alias]
  const args = [...options]
  if (target.port !== DEFAULT_SSH_PORT) args.push('-p', String(target.port))
  if (target.identityFile) args.push('-i', target.identityFile)
  args.push('--', target.user === '' ? target.host : `${target.user}@${target.host}`)
  return args
}

/** 测试连接：不读标准输入（-n），连上后在服务器上立即 `exit`；连接超时 10 秒，免得地址填错时干等。 */
export function sshTestArgs(target: ServerTarget, options: readonly string[] = []): string[] {
  return ['-n', '-o', 'ConnectTimeout=10', ...sshArgs(target, options), 'exit']
}

/** 在服务器上执行一条命令：`-t` 分配远端终端（颜色、交互、Ctrl+C 与停止都能传到远端进程）。 */
export function sshRunArgs(
  target: ServerTarget,
  remoteCommand: string,
  options: readonly string[] = []
): string[] {
  return ['-t', ...sshArgs(target, options), remoteCommand]
}

/**
 * 服务器状态连接（Status Tab）：不分配终端（-T）；每 15 秒保活一次、连续 3 次无响应即断开，
 * 暂停读取期间网络断了也能及时发现。remoteCommand 由服务器经 sh 执行。
 */
export function sshStatusArgs(
  target: ServerTarget,
  remoteCommand: string,
  options: readonly string[] = []
): string[] {
  return [
    '-T',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    ...sshArgs(target, options),
    remoteCommand
  ]
}

/** 测试连接失败的说明：取 ssh 报错的最后一行（如 `Permission denied (…)`），没有输出时给退出代码。 */
export function sshFailureMessage(stderr: string, exitCode: number | null): string {
  const last = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .pop()
  if (last !== undefined) return last
  return exitCode === null ? '连接失败' : `连接失败（退出代码 ${exitCode}）`
}

/** 两个连接目标是否相同（同一连接目标不重复登记）。 */
export function sameServerTarget(a: ServerTarget, b: ServerTarget): boolean {
  if (a.kind === 'config') return b.kind === 'config' && a.alias === b.alias
  if (b.kind === 'config') return false
  return (
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    (a.identityFile ?? '') === (b.identityFile ?? '')
  )
}

/** 手填目标校验：地址必填且不以 `-` 开头、不含空白与 `@`；用户不含空白与 `@`；端口 1–65535。 */
export function manualTargetError(
  target: Extract<ServerTarget, { kind: 'manual' }>
): string | null {
  if (target.host === '') return '请填写地址'
  if (/[\s@]/.test(target.host) || target.host.startsWith('-')) return '地址格式不正确'
  if (/[\s@]/.test(target.user) || target.user.startsWith('-')) return '用户名格式不正确'
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    return '端口应为 1–65535 的整数'
  }
  return null
}

/**
 * 按提问原文判断类型。OpenSSH 不告诉 askpass 是否回显，只能看文字：
 * 首次连接确认主机指纹以 `(yes/no…)?` 收尾；密码提问含 password（服务器自定义的中文提问含「密码」），
 * 私钥口令（passphrase）不算密码；其余一律按需保密的输入处理。
 */
export function classifyAskpassPrompt(prompt: string): AskpassPromptKind {
  if (/\(yes\/no[^)]*\)\?\s*$/i.test(prompt)) return 'confirm'
  if (/passphrase/i.test(prompt)) return 'secret'
  if (/password|密码/i.test(prompt)) return 'password'
  return 'secret'
}

/** 收到 ssh 的一次提问时怎么办：自动作答 / 转给用户 / 拒答（测试连接不向用户要密码）。 */
export type AskpassAction = 'answer' | 'ask' | 'refuse'

/**
 * 密码提问先用可自动作答的密码（记住的，或测试连接时表单里的）答，每次连接只用一次——被拒后 ssh 会再问，
 * 不能拿同一个错误密码反复去试：正常连接转给用户；测试连接只检验表单里的内容，拒答。
 * 没有可自动作答的密码时同理。其余提问（指纹确认、私钥口令、验证码）一律转给用户。
 */
export function askpassAction(
  kind: AskpassPromptKind,
  hasPassword: boolean,
  alreadyUsed: boolean,
  testing: boolean
): AskpassAction {
  if (kind !== 'password') return 'ask'
  if (hasPassword && !alreadyUsed) return 'answer'
  return testing ? 'refuse' : 'ask'
}

/**
 * 密码提问里「记住密码」的初始勾选：本次连接第一次问时不勾；密码错误后重问时沿用上一次——
 * 上一次是用户答的，照他当时的勾选；上一次是自动填入的记住的密码，算作勾着。
 * lastRemember 为本次连接上一次回答密码提问时的勾选，还没答过为 null。
 */
export function askpassRememberDefault(
  lastRemember: boolean | null,
  usedSavedPassword: boolean
): boolean {
  return lastRemember ?? usedSavedPassword
}

/** 从 `~/.ssh/config` 的 Host 模式里挑出可直接连接的别名：跳过含通配符与取反的模式。 */
export function connectableHostAliases(patterns: readonly string[]): string[] {
  return patterns.filter((p) => p !== '' && !/[*?!]/.test(p))
}

/**
 * `ssh -G` 的输出（每行「小写键 值」）按键取值，同键取第一行。
 * 没设置的选项多半不出现（如 `proxycommand`、`bindaddress`、`hostkeyalias`）。
 */
export function parseSshConfigValues(output: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const space = line.indexOf(' ')
    if (space <= 0) continue
    const key = line.slice(0, space)
    if (!values.has(key)) values.set(key, line.slice(space + 1).trim())
  }
  return values
}

/** ssh 的端口值；缺省或不合法时为 22。 */
export function sshPortOf(values: ReadonlyMap<string, string>): number {
  const port = Number(values.get('port'))
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_SSH_PORT
}

/** 解析 `ssh -G <别名>` 的输出，取展示用的地址 / 用户 / 端口。 */
export function parseSshEffectiveConfig(alias: string, output: string): SshConfigHost {
  const values = parseSshConfigValues(output)
  return {
    alias,
    hostName: values.get('hostname') ?? alias,
    user: values.get('user') ?? '',
    port: sshPortOf(values)
  }
}
