// 记住的服务器密码：Electron safeStorage 加密（密钥由系统钥匙串保管），密文 base64 存集中配置
// （ADR-0002 / ADR-0038）。明文只在应答 askpass 的那一刻解出，不落盘、不下发渲染端。

import { safeStorage } from 'electron'
import { getServerSecret, setServerSecret } from './store'

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

export function hasSavedPassword(serverId: string): boolean {
  return getServerSecret(serverId) !== null
}

/** 记住密码；「记住密码」不可用时不存。 */
export function savePassword(serverId: string, password: string): void {
  if (passwordUnavailableReason() !== null) return
  setServerSecret(serverId, safeStorage.encryptString(password).toString('base64'))
}

export function forgetPassword(serverId: string): void {
  setServerSecret(serverId, null)
}

/** 解出记住的密码；没有或解不开（换了钥匙串等）返回 null。 */
export function readSavedPassword(serverId: string): string | null {
  const secret = getServerSecret(serverId)
  if (secret === null) return null
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch {
    return null
  }
}
