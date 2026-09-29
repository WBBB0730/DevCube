// 服务器（Server）与 SSH 终端（SSH Terminal）的域模型与纯函数；术语见 CONTEXT.md，
// 连接方式见 ADR-0041（配置由系统 OpenSSH 解析，连接由内置的 ssh2 完成）。

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
 * `ssh -G` 取生效配置时给的目标参数。以 `--` 结束选项，目标不会被当成选项解析，且最后一个参数即主机名
 * （令牌 `%n`）；手填目标的用户 / 端口 / 私钥用命令行选项给出，其余仍走 ssh 的默认规则与 `~/.ssh/config`。
 */
export function sshArgs(target: ServerTarget): string[] {
  if (target.kind === 'config') return ['--', target.alias]
  const args: string[] = []
  if (target.user !== '') args.push('-l', target.user)
  if (target.port !== DEFAULT_SSH_PORT) args.push('-p', String(target.port))
  if (target.identityFile) args.push('-i', target.identityFile)
  args.push('--', target.host)
  return args
}

/** ssh 的报错说明（`ssh -G` 失败、代理命令的报错）：取最后一行（如 `Permission denied (…)`），没有输出时给退出代码。 */
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

/** 从 `~/.ssh/config` 的 Host 模式里挑出可直接连接的别名：跳过含通配符与取反的模式。 */
export function connectableHostAliases(patterns: readonly string[]): string[] {
  return patterns.filter((p) => p !== '' && !/[*?!]/.test(p))
}
