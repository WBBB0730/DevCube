// 公钥认证用的密钥（docs/prd/ssh-connection.md「认证」）：agent 里的密钥与 IdentityFile 的私钥合成一个 ssh2 agent，
// 由 ssh2 逐个向服务器提出。私钥的公钥部分（`.pub` 或 OpenSSH 私钥文件头）先拿去问服务器，服务器接受了才解密私钥
// 签名——同 OpenSSH，不会为服务器不认的私钥问口令。

import { readFile } from 'node:fs/promises'
import {
  BaseAgent,
  utils,
  type IdentityCallback,
  type ParsedKey,
  type SignCallback,
  type SigningRequestOptions
} from 'ssh2'
import { keyTypeOfBlob } from './known-hosts'

/**
 * OpenSSH 新格式私钥（`openssh-key-v1`）的公钥 blob：文件头里明文存着，私钥加了口令也读得到。
 * 不是这种格式或读不出时为 null。
 */
export function openSshPrivateKeyPublicBlob(text: string): Buffer | null {
  const body =
    /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]+?)-----END OPENSSH PRIVATE KEY-----/.exec(text)
  if (!body) return null
  const data = Buffer.from(body[1]!.replace(/\s+/g, ''), 'base64')
  const magic = Buffer.from('openssh-key-v1\0', 'latin1')
  if (!data.subarray(0, magic.length).equals(magic)) return null
  let offset = magic.length
  const readString = (): Buffer => {
    const length = data.readUInt32BE(offset)
    const value = data.subarray(offset + 4, offset + 4 + length)
    offset += 4 + length
    return value
  }
  try {
    readString() // 加密算法
    readString() // 密钥派生算法
    readString() // 派生参数
    const count = data.readUInt32BE(offset)
    offset += 4
    return count < 1 ? null : readString()
  } catch {
    return null
  }
}

function publicKeyOfBlob(blob: Buffer): ParsedKey | null {
  const key = utils.parseKey(`${keyTypeOfBlob(blob)} ${blob.toString('base64')}`)
  return key instanceof Error ? null : key
}

/** 一把可用于认证的密钥：由 agent 签名，或由私钥文件签名。 */
interface Identity {
  publicKey: ParsedKey
  agent: BaseAgent | null
  file: string | null
}

/** 私钥文件：公钥部分已知（未知时为 null，要先解密才知道），以及私钥本身（没加口令时已解出）。 */
interface KeyFile {
  file: string
  publicKey: ParsedKey | null
  privateKey: ParsedKey | null
  raw: Buffer
}

/** 读私钥文件：不存在为 missing，类型不支持（`sk-` 硬件密钥等）为 unsupported。 */
async function readKeyFile(file: string): Promise<KeyFile | 'missing' | 'unsupported'> {
  let raw: Buffer
  try {
    raw = await readFile(file)
  } catch {
    return 'missing'
  }
  const parsed = utils.parseKey(raw)
  if (!(parsed instanceof Error)) return { file, publicKey: parsed, privateKey: parsed, raw }
  if (!/passphrase/i.test(parsed.message)) return 'unsupported'
  let publicKey: ParsedKey | null = null
  try {
    const pub = utils.parseKey(await readFile(`${file}.pub`))
    if (!(pub instanceof Error)) publicKey = pub
  } catch {
    // 没有 .pub
  }
  if (publicKey === null) {
    const blob = openSshPrivateKeyPublicBlob(raw.toString('latin1'))
    if (blob !== null) {
      publicKey = publicKeyOfBlob(blob)
      // 文件头里的公钥类型 ssh2 不支持（`sk-` 硬件密钥等）：同没加口令时，不必问口令
      if (publicKey === null) return 'unsupported'
    }
  }
  return { file, publicKey, privateKey: null, raw }
}

export interface IdentitySources {
  /** ssh-agent；不用 agent 时为 null */
  agent: BaseAgent | null
  /** IdentityFile，已展开为绝对路径，按配置顺序 */
  files: readonly string[]
  identitiesOnly: boolean
  /** 解密加了口令的私钥：记住的口令或问用户；放弃这把私钥时为 null */
  unlock: (file: string, raw: Buffer) => Promise<ParsedKey | null>
}

/**
 * 公钥认证的 agent：同 OpenSSH 的顺序——IdentityFile 里 agent 也有的（由 agent 签名）→ agent 里其余的
 * （IdentitiesOnly 时不用）→ IdentityFile 里 agent 没有的（由私钥文件签名，要口令时这时才问）。
 */
export class IdentityAgent extends BaseAgent<ParsedKey> {
  /** 有私钥因为类型不支持而没用上（认证失败时点明） */
  unsupported = false
  private identities: Identity[] | null = null
  private readonly keyFiles = new Map<string, KeyFile>()

  constructor(private readonly sources: IdentitySources) {
    super()
  }

  getIdentities(cb: IdentityCallback<ParsedKey>): void {
    this.load().then(
      (identities) =>
        cb(
          null,
          identities.map((i) => i.publicKey)
        ),
      (error: Error) => cb(error)
    )
  }

  sign(
    pubKey: ParsedKey,
    data: Buffer,
    options: SigningRequestOptions | SignCallback,
    cb?: SignCallback
  ): void {
    const done = typeof options === 'function' ? options : cb!
    const opts = typeof options === 'function' ? {} : options
    const identity = this.identities?.find((i) => i.publicKey.equals(pubKey))
    if (identity === undefined) {
      done(new Error('未知的密钥'))
      return
    }
    if (identity.agent !== null) {
      identity.agent.sign(pubKey, data, opts, done)
      return
    }
    this.privateKeyOf(identity.file!).then(
      (key) => {
        if (key === null) return done(new Error('已放弃这把私钥'))
        const signature = key.sign(data, opts.hash)
        if (signature instanceof Error) done(signature)
        else done(null, signature)
      },
      (error: Error) => done(error)
    )
  }

  private async privateKeyOf(file: string): Promise<ParsedKey | null> {
    const keyFile = this.keyFiles.get(file)!
    keyFile.privateKey ??= await this.sources.unlock(file, keyFile.raw)
    return keyFile.privateKey
  }

  private async load(): Promise<Identity[]> {
    if (this.identities !== null) return this.identities
    const { agent, files, identitiesOnly, unlock } = this.sources
    const agentKeys = agent === null ? [] : await agentIdentities(agent)
    const inAgent: Identity[] = []
    const fromFiles: Identity[] = []
    for (const file of files) {
      const keyFile = await readKeyFile(file)
      if (keyFile === 'missing') continue
      if (keyFile === 'unsupported') {
        this.unsupported = true
        continue
      }
      this.keyFiles.set(file, keyFile)
      const held = keyFile.publicKey && agentKeys.find((k) => k.equals(keyFile.publicKey!))
      if (held) {
        inAgent.push({ publicKey: held, agent, file: null })
        continue
      }
      // 公钥部分读不出（老格式私钥加了口令又没有 .pub）：只能先解密，同 OpenSSH
      if (keyFile.publicKey === null) keyFile.privateKey = await unlock(file, keyFile.raw)
      const publicKey = keyFile.publicKey ?? keyFile.privateKey
      if (publicKey !== null) fromFiles.push({ publicKey, agent: null, file })
    }
    const restOfAgent = identitiesOnly
      ? []
      : agentKeys
          .filter((k) => !inAgent.some((i) => i.publicKey.equals(k)))
          .map((publicKey) => ({ publicKey, agent, file: null }))
    this.identities = [...inAgent, ...restOfAgent, ...fromFiles]
    return this.identities
  }
}

/** agent 里的密钥；连不上 agent 或读不了时为空（同 OpenSSH，照常试别的方式）。 */
function agentIdentities(agent: BaseAgent): Promise<ParsedKey[]> {
  return new Promise((resolve) => {
    agent.getIdentities((err, keys) => {
      if (err || !keys) return resolve([])
      resolve(
        keys
          .map((k) => utils.parseKey(k as Buffer | string))
          .filter((k): k is ParsedKey => !(k instanceof Error))
      )
    })
  })
}
