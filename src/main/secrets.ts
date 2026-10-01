// 记住的密码与口令：加解密与按表单的处理写入。Electron safeStorage 加密（密钥由系统钥匙串保管），密文 base64 存
// 集中配置（ADR-0002）。服务器（server-secrets）与数据源（data-sources）共用；明文只在连接作答的那一刻解出，
// 不落盘、不下发渲染端。

import { safeStorage } from 'electron'
import type { PasswordChange } from '../shared/connection'

/**
 * 「记住密码」为什么不可用；可用时为 null。Linux 上 safeStorage 找不到系统钥匙串时会退回
 * basic_text（用写死的口令加密，形同明文），这种情况也不提供。
 */
export function passwordUnavailableReason(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return '系统没有可用的钥匙串，无法安全地记住密码'
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return '当前桌面环境没有可用的钥匙串，无法安全地记住密码'
  }
  return null
}

function encryptSecret(value: string): string {
  return safeStorage.encryptString(value).toString('base64')
}

/**
 * 按表单对记住的密码的处理改一项记住的密码或口令：undefined 不动；null 删掉；字符串加密后记住
 * （「记住密码」不可用时不存）。setSecret 写这一项的密文，null 为删掉。
 */
export function applyPasswordChange(
  change: PasswordChange,
  setSecret: (secret: string | null) => void
): void {
  if (change === undefined) return
  if (change === null) setSecret(null)
  else if (passwordUnavailableReason() === null) setSecret(encryptSecret(change))
}

/** 解出密文；没有或解不开（换了钥匙串等）返回 null。 */
export function decryptSecret(secret: string | null): string | null {
  if (secret === null) return null
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch {
    return null
  }
}
