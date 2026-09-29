// 记住的服务器密码与私钥口令：Electron safeStorage 加密（密钥由系统钥匙串保管），密文 base64 存集中配置
// （ADR-0002 / ADR-0038 / ADR-0041）。明文只在连接作答的那一刻解出，不落盘、不下发渲染端。

import { safeStorage } from 'electron'
import {
  getKeyPassphraseSecret,
  getServerSecret,
  setKeyPassphraseSecret,
  setServerSecret
} from './store'

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

function encrypt(value: string): string {
  return safeStorage.encryptString(value).toString('base64')
}

/** 解出密文；没有或解不开（换了钥匙串等）返回 null。 */
function decrypt(secret: string | null): string | null {
  if (secret === null) return null
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch {
    return null
  }
}

export function hasSavedPassword(serverId: string): boolean {
  return getServerSecret(serverId) !== null
}

/** 记住密码；「记住密码」不可用时不存。 */
export function savePassword(serverId: string, password: string): void {
  if (passwordUnavailableReason() !== null) return
  setServerSecret(serverId, encrypt(password))
}

export function forgetPassword(serverId: string): void {
  setServerSecret(serverId, null)
}

export function readSavedPassword(serverId: string): string | null {
  return decrypt(getServerSecret(serverId))
}

/** 记住私钥口令（按私钥文件的绝对路径）；不可用时不存，同记住密码。 */
export function savePassphrase(keyFile: string, passphrase: string): void {
  if (passwordUnavailableReason() !== null) return
  setKeyPassphraseSecret(keyFile, encrypt(passphrase))
}

export function readSavedPassphrase(keyFile: string): string | null {
  return decrypt(getKeyPassphraseSecret(keyFile))
}
