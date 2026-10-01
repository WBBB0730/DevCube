// 记住的服务器密码与私钥口令（ADR-0038 / ADR-0041），加解密与按表单的处理写入见 secrets.ts。

import type { PasswordChange } from '../shared/connection'
import { applyPasswordChange, decryptSecret } from './secrets'
import {
  getKeyPassphraseSecret,
  getServerSecret,
  setKeyPassphraseSecret,
  setServerSecret
} from './store'

export function hasSavedPassword(serverId: string): boolean {
  return getServerSecret(serverId) !== null
}

/** 按表单的处理改记住的密码（见 applyPasswordChange）。 */
export function applyServerPassword(serverId: string, password: PasswordChange): void {
  applyPasswordChange(password, (secret) => setServerSecret(serverId, secret))
}

export function readSavedPassword(serverId: string): string | null {
  return decryptSecret(getServerSecret(serverId))
}

/** 记住私钥口令（按私钥文件的绝对路径）；不可用时不存，同记住密码。 */
export function savePassphrase(keyFile: string, passphrase: string): void {
  applyPasswordChange(passphrase, (secret) => setKeyPassphraseSecret(keyFile, secret))
}

export function readSavedPassphrase(keyFile: string): string | null {
  return decryptSecret(getKeyPassphraseSecret(keyFile))
}
