// known_hosts 的核对与写入（docs/prd/ssh-connection.md「主机密钥核对」）：与终端里的 ssh 共用同一份文件。
// 查找与删除交给系统 OpenSSH 的 ssh-keygen（`-F` / `-R`，Ansible 的 known_hosts 模块同样如此）：明文、逗号列表、
// 通配、取反、哈希条目、`@revoked` 都由它按 OpenSSH 的规则认；DevCube 只比对密钥、在文件末尾追加新记录。

import { execFile } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_SSH_PORT } from '../shared/server'
import type { HostKeyStatus } from '../shared/ssh-connect'

const execFileAsync = promisify(execFile)

/** known_hosts 里对上这台主机的一条记录。 */
export interface KnownHostEntry {
  file: string
  marker: 'revoked' | 'cert-authority' | null
  keyType: string
  /** 密钥，base64 */
  key: string
}

/** 核对用的名字：有 HostKeyAlias 用它，否则用 hostname；端口不是 22 时写成 `[名字]:端口`；一律小写，同 OpenSSH。 */
export function knownHostsLookupName(name: string, port: number): string {
  const lower = name.toLowerCase()
  return port === DEFAULT_SSH_PORT ? lower : `[${lower}]:${port}`
}

/**
 * 解析 `ssh-keygen -F <名字> -f <文件>` 的输出：`#` 开头的是说明行，其余每行是一条对上的记录，
 * 原样照录（`@revoked` / `@cert-authority` 标记在行首）。
 */
export function parseKeygenFindOutput(file: string, output: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const fields = line.split(/\s+/)
    let marker: KnownHostEntry['marker'] = null
    if (fields[0]!.startsWith('@')) {
      const name = fields.shift()!.slice(1)
      if (name !== 'revoked' && name !== 'cert-authority') continue
      marker = name
    }
    const [, keyType, key] = fields
    if (keyType !== undefined && key !== undefined) entries.push({ file, marker, keyType, key })
  }
  return entries
}

/** 核对结果；已更改时带上记着旧密钥的记录（「更新并连接」时要删掉）。 */
export interface HostKeyCheck {
  status: HostKeyStatus
  stale: KnownHostEntry[]
}

/**
 * 核对主机密钥（entries 为 ssh-keygen 查出的这台主机的记录）：同类型同密钥为 known；同类型但密钥不同为
 * changed；这个类型没有记录为 unknown（即便记着别的类型）；`@revoked` 标记了这把密钥为 revoked；
 * `@cert-authority`（主机证书）不支持，忽略。
 */
export function checkHostKey(
  entries: readonly KnownHostEntry[],
  keyType: string,
  key: string
): HostKeyCheck {
  if (entries.some((e) => e.marker === 'revoked' && e.keyType === keyType && e.key === key)) {
    return { status: 'revoked', stale: [] }
  }
  const sameType = entries.filter((e) => e.marker === null && e.keyType === keyType)
  if (sameType.some((e) => e.key === key)) return { status: 'known', stale: [] }
  if (sameType.length > 0) return { status: 'changed', stale: sameType }
  return { status: 'unknown', stale: [] }
}

/** 这台主机已记着的密钥类型（协商主机密钥算法时优先用这些）。 */
export function knownKeyTypes(entries: readonly KnownHostEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.marker === null).map((e) => e.keyType))]
}

/** 写入 known_hosts 的一行；hash 时主机字段写成哈希（HashKnownHosts yes，同 ssh-keygen -H），salt 缺省随机。 */
export function formatKnownHostsLine(
  name: string,
  keyType: string,
  key: string,
  hash: boolean,
  salt: Buffer = randomBytes(20)
): string {
  if (!hash) return `${name} ${keyType} ${key}`
  const hmac = createHmac('sha1', salt).update(name).digest('base64')
  return `|1|${salt.toString('base64')}|${hmac} ${keyType} ${key}`
}

/** SHA256 指纹，同 OpenSSH 的写法：`SHA256:` 加不带填充的 Base64。 */
export function sha256Fingerprint(keyBlob: Buffer): string {
  return `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`
}

/** 公钥 blob 开头的类型名（SSH 线格式：4 字节长度 + 名字）。 */
export function keyTypeOfBlob(blob: Buffer): string {
  if (blob.length < 4) return ''
  const length = blob.readUInt32BE(0)
  return blob.subarray(4, 4 + length).toString('latin1')
}

// —— 文件 ——

/**
 * 在这些文件里查这台主机的记录（`ssh-keygen -F`）。没找到时它以 1 退出（很老的版本以 0 退出、没有输出）；
 * 文件不存在或读不了时跳过，同 OpenSSH。
 */
export async function findKnownHosts(
  keygen: string,
  files: readonly string[],
  name: string
): Promise<KnownHostEntry[]> {
  const all = await Promise.all(
    files.map(async (file) => {
      try {
        const { stdout } = await execFileAsync(keygen, ['-F', name, '-f', file], { timeout: 5000 })
        return parseKeygenFindOutput(file, stdout)
      } catch {
        return []
      }
    })
  )
  return all.flat()
}

/** 追加一行；目录与文件不存在时创建（权限 700 / 600，同 OpenSSH）。 */
export async function appendKnownHost(file: string, line: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  let prefix = ''
  try {
    const content = await readFile(file, 'utf8')
    if (content !== '' && !content.endsWith('\n')) prefix = '\n'
  } catch {
    // 文件还不存在
  }
  await appendFile(file, `${prefix}${line}\n`, { mode: 0o600 })
}

/**
 * 「更新并连接」：在记着旧密钥的文件里删掉这台主机的记录（`ssh-keygen -R`，整行删，原文件留作 `.old`，
 * 同 OpenSSH 提示用户的做法），再在 file 末尾写入新的一行。
 */
export async function replaceKnownHost(
  keygen: string,
  stale: readonly KnownHostEntry[],
  name: string,
  file: string,
  line: string
): Promise<void> {
  for (const f of new Set(stale.map((e) => e.file))) {
    await execFileAsync(keygen, ['-R', name, '-f', f], { timeout: 5000 })
  }
  await appendKnownHost(file, line)
}
