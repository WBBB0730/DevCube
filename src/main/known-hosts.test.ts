import { describe, expect, it } from 'vitest'
import {
  checkHostKey,
  formatKnownHostsLine,
  keyTypeOfBlob,
  knownHostsLookupName,
  knownKeyTypes,
  parseKeygenFindOutput,
  sha256Fingerprint,
  type KnownHostEntry
} from './known-hosts'

// 对照数据由 OpenSSH 9.9 的 ssh-keygen 生成：公钥、`ssh-keygen -lf` 的指纹、`ssh-keygen -H` 哈希后的条目、
// `ssh-keygen -F` 的输出
const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIPDGfy4Pxi/Znc/Y+EA37dmMSTVH5PJ0ob4dCR2URaxe'
const FINGERPRINT = 'SHA256:TksRzqer8TS04l6E35dr5gG8jbdQoe3te+u1CcBwktI'
const HASHED_EXAMPLE = '|1|uPnJVa6mnjhUCDZqQS+DHCFHxSU=|HHFxO8ilyAWXheMikYOzM5GZjd0='
const OTHER = 'AAAAC3NzaC1lZDI1NTE5AAAAIOtherOtherOtherOtherOtherOtherOtherOth'

const FIND_OUTPUT = `# Host hashed.example.com found: line 5 REVOKED
@revoked * ssh-ed25519 ${OTHER}
# Host hashed.example.com found: line 7
|1|Eeov+7Dj9YdY5KEVsMvJd+fDE+8=|u1D+KGi7bm4zCrRn2XiV3l1W7PQ= ssh-ed25519 ${KEY}
# Host hashed.example.com found: line 8 CA
@cert-authority *.example.com ssh-ed25519 ${KEY}
`

const entry = (partial: Partial<KnownHostEntry>): KnownHostEntry => ({
  file: '/k',
  marker: null,
  keyType: 'ssh-ed25519',
  key: KEY,
  ...partial
})

describe('knownHostsLookupName', () => {
  it('22 端口为主机名，其余为 [名字]:端口，一律小写', () => {
    expect(knownHostsLookupName('Example.COM', 22)).toBe('example.com')
    expect(knownHostsLookupName('10.0.0.5', 2222)).toBe('[10.0.0.5]:2222')
  })
})

describe('parseKeygenFindOutput', () => {
  it('跳过说明行，取每条记录的标记、类型与密钥（Windows 的换行也认）', () => {
    expect(parseKeygenFindOutput('/k', FIND_OUTPUT.replace(/\n/g, '\r\n'))).toEqual([
      entry({ marker: 'revoked', key: OTHER }),
      entry({}),
      entry({ marker: 'cert-authority' })
    ])
  })

  it('没找到时没有输出', () => {
    expect(parseKeygenFindOutput('/k', '')).toEqual([])
  })
})

describe('checkHostKey', () => {
  it('同类型同密钥为 known', () => {
    expect(checkHostKey([entry({})], 'ssh-ed25519', KEY).status).toBe('known')
  })

  it('同类型但密钥不同为 changed，带上旧记录', () => {
    const check = checkHostKey([entry({ key: OTHER })], 'ssh-ed25519', KEY)
    expect(check.status).toBe('changed')
    expect(check.stale.map((e) => e.key)).toEqual([OTHER])
  })

  it('只记着别的类型、或没有记录为 unknown', () => {
    const ecdsa = entry({ keyType: 'ecdsa-sha2-nistp256', key: 'AAAA' })
    expect(checkHostKey([ecdsa], 'ssh-ed25519', KEY).status).toBe('unknown')
    expect(checkHostKey([], 'ssh-ed25519', KEY).status).toBe('unknown')
  })

  it('@revoked 的密钥一律拒绝；@cert-authority 忽略', () => {
    expect(checkHostKey([entry({ marker: 'revoked' }), entry({})], 'ssh-ed25519', KEY).status).toBe(
      'revoked'
    )
    expect(
      checkHostKey([entry({ marker: 'cert-authority', key: OTHER })], 'ssh-ed25519', KEY).status
    ).toBe('unknown')
  })
})

describe('knownKeyTypes', () => {
  it('这台主机已记着的类型（去重，不含标记行）', () => {
    const entries = [
      entry({ keyType: 'ssh-rsa', key: 'AAAA' }),
      entry({}),
      entry({ keyType: 'ssh-rsa', key: 'BBBB' }),
      entry({ marker: 'revoked', keyType: 'ecdsa-sha2-nistp256' })
    ]
    expect(knownKeyTypes(entries)).toEqual(['ssh-rsa', 'ssh-ed25519'])
  })
})

describe('formatKnownHostsLine', () => {
  it('不哈希：名字 类型 密钥', () => {
    expect(formatKnownHostsLine('[10.0.0.5]:2222', 'ssh-ed25519', KEY, false)).toBe(
      `[10.0.0.5]:2222 ssh-ed25519 ${KEY}`
    )
  })

  it('哈希：与 ssh-keygen -H 的写法一致（同一个盐得到同一行）', () => {
    const salt = Buffer.from('uPnJVa6mnjhUCDZqQS+DHCFHxSU=', 'base64')
    expect(formatKnownHostsLine('example.com', 'ssh-ed25519', KEY, true, salt)).toBe(
      `${HASHED_EXAMPLE} ssh-ed25519 ${KEY}`
    )
  })
})

describe('指纹与类型', () => {
  it('SHA256 指纹与 ssh-keygen -lf 一致', () => {
    expect(sha256Fingerprint(Buffer.from(KEY, 'base64'))).toBe(FINGERPRINT)
  })

  it('从公钥 blob 读出类型', () => {
    expect(keyTypeOfBlob(Buffer.from(KEY, 'base64'))).toBe('ssh-ed25519')
    expect(keyTypeOfBlob(Buffer.alloc(2))).toBe('')
  })
})
