// 内置 SSH 连接的决策与提问（docs/prd/ssh-connection.md、ADR-0041）：主机密钥核对结果怎么处理、
// 交互式认证的提问是不是在问密码、连接失败的中文原因，以及主进程交给用户回答的提问。

import { networkErrorReason } from './connection'
import type { StrictHostKeyChecking } from './ssh-config'

/** 主机密钥与 known_hosts 核对的结果。 */
export type HostKeyStatus = 'known' | 'unknown' | 'changed' | 'revoked'

/**
 * 核对结果怎么处理：accept 放行；confirm-new / confirm-changed 问用户；add 直接写入 known_hosts 后放行；
 * accept-once 放行但不改记录，这次不用密码与交互式认证（同 OpenSSH 的 StrictHostKeyChecking no）；refuse 拒绝连接。
 */
export type HostKeyAction =
  'accept' | 'confirm-new' | 'confirm-changed' | 'add' | 'accept-once' | 'refuse'

/**
 * 同 OpenSSH 的 StrictHostKeyChecking（ssh_config(5)），只在询问档遇到密钥已更改时照 WebStorm 多给一个
 * 「更新并连接」（OpenSSH 直接拒绝）。BatchMode 下不能问，要问的一律拒绝。
 */
export function hostKeyAction(
  strict: StrictHostKeyChecking,
  status: HostKeyStatus,
  batchMode: boolean
): HostKeyAction {
  if (status === 'revoked') return 'refuse'
  if (status === 'known') return 'accept'
  if (status === 'unknown') {
    if (strict === 'ask') return batchMode ? 'refuse' : 'confirm-new'
    return strict === 'yes' ? 'refuse' : 'add'
  }
  if (strict === 'ask') return batchMode ? 'refuse' : 'confirm-changed'
  return strict === 'no' ? 'accept-once' : 'refuse'
}

/** 主机密钥类型的叫法（同 OpenSSH 提示里的写法）。 */
export function hostKeyTypeLabel(keyType: string): string {
  if (keyType === 'ssh-ed25519') return 'ED25519'
  if (keyType.startsWith('ecdsa-')) return 'ECDSA'
  if (keyType === 'ssh-rsa') return 'RSA'
  if (keyType === 'ssh-dss') return 'DSA'
  return keyType
}

/**
 * 密码提问里「记住密码」的初始勾选：本次连接第一次问时不勾；密码错误后重问时沿用上一次——
 * 上一次是用户答的，照用户当时的勾选；上一次是自动填入的记住的密码，算作勾着。
 * lastRemember 为本次连接上一次回答密码提问时的勾选，还没答过为 null。
 */
export function rememberPasswordDefault(
  lastRemember: boolean | null,
  usedSavedPassword: boolean
): boolean {
  return lastRemember ?? usedSavedPassword
}

/** 服务器交互式认证（keyboard-interactive）的一项提问。 */
export interface SshChallengePrompt {
  prompt: string
  echo: boolean
}

/** 服务器只问一项、不回显、提问里有 password / 密码：当作密码处理（可用记住的密码作答）。 */
export function isPasswordChallenge(prompts: readonly SshChallengePrompt[]): boolean {
  return prompts.length === 1 && !prompts[0]!.echo && /password|密码/i.test(prompts[0]!.prompt)
}

/** 主进程交给用户回答的一次提问。 */
export type SshPrompt =
  | { kind: 'host-unknown'; host: string; keyType: string; fingerprint: string }
  | {
      kind: 'host-changed'
      host: string
      keyType: string
      fingerprint: string
      /** 要更新的 known_hosts 文件 */
      knownHostsFile: string
    }
  | {
      kind: 'password'
      /** 可以勾选「记住密码」 */
      canRemember: boolean
      rememberDefault: boolean
      /** 上一次的密码（记住的或刚输入的）被服务器拒绝 */
      rejected: boolean
    }
  | { kind: 'passphrase'; keyFile: string; canRemember: boolean; rejected: boolean }
  | { kind: 'challenge'; name: string; instructions: string; prompts: SshChallengePrompt[] }

/** 主进程 → 渲染端：请用户回答一次提问。 */
export interface SshPromptRequest {
  id: string
  /** 正在连接的 `用户@主机`（经跳板机时为正在连接的那一跳） */
  destination: string
  prompt: SshPrompt
}

/**
 * 渲染端 → 主进程：用户的回答。answers 为 null 表示取消；主机密钥提问确认为空数组，
 * 密码与私钥口令为 `[输入]`，交互式提问为各项的回答。
 */
export interface SshPromptResponse {
  id: string
  answers: string[] | null
  remember: boolean
}

/** 连接失败时的错误信息：Node 的网络错误带 code，ssh2 的错误只有英文说明。 */
export interface SshFailure {
  code?: string
  message: string
}

const ALGORITHM_KINDS: [RegExp, string][] = [
  [/key exchange/, '密钥交换'],
  [/host key/, '主机密钥'],
  [/cipher/, '加密'],
  [/MAC/, '消息校验'],
  [/compression/, '压缩']
]

/** 连接失败的原因（中文）；认不出的给原文。 */
export function sshFailureReason(failure: SshFailure): string {
  const network = networkErrorReason(failure.code)
  if (network !== undefined) return network
  const { message } = failure
  if (message === 'Keepalive timeout') return '服务器无响应'
  if (message === 'Connection lost before handshake') return '连接在握手前被断开'
  if (message.startsWith('Host denied')) return '主机密钥核对失败'
  if (message === 'All configured authentication methods failed') return '认证失败'
  const noMatch = /^Handshake failed: no matching (.+)$/.exec(message)
  if (noMatch) {
    const kind = ALGORITHM_KINDS.find(([re]) => re.test(noMatch[1]!))?.[1]
    if (kind !== undefined) return `与服务器没有共同支持的${kind}算法`
  }
  return message
}
