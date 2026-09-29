import { describe, expect, it } from 'vitest'
import {
  hostKeyAction,
  hostKeyTypeLabel,
  isPasswordChallenge,
  rememberPasswordDefault,
  sshFailureReason
} from './ssh-connect'

describe('hostKeyAction', () => {
  it('一致放行；被吊销一律拒绝', () => {
    expect(hostKeyAction('ask', 'known', false)).toBe('accept')
    expect(hostKeyAction('no', 'revoked', false)).toBe('refuse')
  })

  it('未知：询问档问用户，accept-new 与 no 直接写入，yes 拒绝', () => {
    expect(hostKeyAction('ask', 'unknown', false)).toBe('confirm-new')
    expect(hostKeyAction('accept-new', 'unknown', false)).toBe('add')
    expect(hostKeyAction('no', 'unknown', false)).toBe('add')
    expect(hostKeyAction('yes', 'unknown', false)).toBe('refuse')
  })

  it('已更改：询问档可更新并连接，accept-new 与 yes 拒绝，no 放行但不改记录', () => {
    expect(hostKeyAction('ask', 'changed', false)).toBe('confirm-changed')
    expect(hostKeyAction('accept-new', 'changed', false)).toBe('refuse')
    expect(hostKeyAction('yes', 'changed', false)).toBe('refuse')
    expect(hostKeyAction('no', 'changed', false)).toBe('accept-once')
  })

  it('BatchMode 下要问的一律拒绝', () => {
    expect(hostKeyAction('ask', 'unknown', true)).toBe('refuse')
    expect(hostKeyAction('ask', 'changed', true)).toBe('refuse')
    expect(hostKeyAction('accept-new', 'unknown', true)).toBe('add')
  })
})

describe('hostKeyTypeLabel', () => {
  it('同 OpenSSH 提示里的叫法', () => {
    expect(hostKeyTypeLabel('ssh-ed25519')).toBe('ED25519')
    expect(hostKeyTypeLabel('ecdsa-sha2-nistp384')).toBe('ECDSA')
    expect(hostKeyTypeLabel('ssh-rsa')).toBe('RSA')
    expect(hostKeyTypeLabel('x-unknown')).toBe('x-unknown')
  })
})

describe('rememberPasswordDefault', () => {
  it('第一次问密码时不勾', () => {
    expect(rememberPasswordDefault(null, false)).toBe(false)
  })

  it('自动填入的记住的密码被拒后重问：算作勾着', () => {
    expect(rememberPasswordDefault(null, true)).toBe(true)
  })

  it('用户答错后重问：沿用用户上一次的勾选', () => {
    expect(rememberPasswordDefault(true, false)).toBe(true)
    expect(rememberPasswordDefault(false, false)).toBe(false)
    expect(rememberPasswordDefault(false, true)).toBe(false)
  })
})

describe('isPasswordChallenge', () => {
  it('只问一项、不回显、提问里有 password / 密码', () => {
    expect(isPasswordChallenge([{ prompt: 'Password: ', echo: false }])).toBe(true)
    expect(isPasswordChallenge([{ prompt: '请输入密码：', echo: false }])).toBe(true)
  })

  it('验证码、回显的、多项的都不算', () => {
    expect(isPasswordChallenge([{ prompt: 'Verification code: ', echo: false }])).toBe(false)
    expect(isPasswordChallenge([{ prompt: 'Password: ', echo: true }])).toBe(false)
    expect(
      isPasswordChallenge([
        { prompt: 'Password: ', echo: false },
        { prompt: 'Code: ', echo: false }
      ])
    ).toBe(false)
  })
})

describe('sshFailureReason', () => {
  it('网络错误按 code 归类', () => {
    expect(sshFailureReason({ code: 'ECONNREFUSED', message: 'x' })).toBe('连接被拒绝')
    expect(sshFailureReason({ code: 'ENOTFOUND', message: 'x' })).toBe('找不到主机')
    expect(sshFailureReason({ code: 'ETIMEDOUT', message: 'x' })).toBe('连接超时')
    expect(sshFailureReason({ code: 'ECONNRESET', message: 'x' })).toBe('连接被服务器重置')
  })

  it('ssh2 的报错换成中文', () => {
    expect(sshFailureReason({ message: 'Keepalive timeout' })).toBe('服务器无响应')
    expect(sshFailureReason({ message: 'All configured authentication methods failed' })).toBe(
      '认证失败'
    )
    expect(sshFailureReason({ message: 'Host denied (verification failed)' })).toBe(
      '主机密钥核对失败'
    )
    expect(
      sshFailureReason({ message: 'Handshake failed: no matching key exchange algorithm' })
    ).toBe('与服务器没有共同支持的密钥交换算法')
    expect(sshFailureReason({ message: 'Handshake failed: no matching C->S cipher' })).toBe(
      '与服务器没有共同支持的加密算法'
    )
  })

  it('认不出的给原文', () => {
    expect(sshFailureReason({ message: 'something else' })).toBe('something else')
  })
})
