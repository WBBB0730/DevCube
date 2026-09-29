import { describe, expect, it } from 'vitest'
import {
  connectableHostAliases,
  manualTargetError,
  sameServerTarget,
  serverTargetLabel,
  sshArgs,
  sshFailureMessage,
  supportsSshDirect,
  type ServerTarget
} from './server'

const manual = (
  partial: Partial<Extract<ServerTarget, { kind: 'manual' }>> = {}
): Extract<ServerTarget, { kind: 'manual' }> => ({
  kind: 'manual',
  host: '10.0.0.8',
  user: 'root',
  port: 22,
  ...partial
})

describe('serverTargetLabel', () => {
  it('别名原样', () => {
    expect(serverTargetLabel({ kind: 'config', alias: 'prod' })).toBe('prod')
  })

  it('手填：默认端口不显示，非默认追加', () => {
    expect(serverTargetLabel(manual())).toBe('root@10.0.0.8')
    expect(serverTargetLabel(manual({ port: 2222 }))).toBe('root@10.0.0.8:2222')
    expect(serverTargetLabel(manual({ user: '' }))).toBe('10.0.0.8')
  })
})

describe('sshArgs', () => {
  it('别名：-- 之后接别名', () => {
    expect(sshArgs({ kind: 'config', alias: 'prod' })).toEqual(['--', 'prod'])
  })

  it('手填：用户、非默认端口与私钥用选项给出，最后一个参数是主机名', () => {
    expect(sshArgs(manual())).toEqual(['-l', 'root', '--', '10.0.0.8'])
    expect(sshArgs(manual({ port: 2222, identityFile: '/k/id', user: '' }))).toEqual([
      '-p',
      '2222',
      '-i',
      '/k/id',
      '--',
      '10.0.0.8'
    ])
  })
})

describe('supportsSshDirect', () => {
  it('只在 macOS / Windows 提供', () => {
    expect(supportsSshDirect('darwin')).toBe(true)
    expect(supportsSshDirect('win32')).toBe(true)
    expect(supportsSshDirect('linux')).toBe(false)
  })
})

describe('sshFailureMessage', () => {
  it('取 ssh 报错的最后一行', () => {
    expect(
      sshFailureMessage(
        "Warning: Permanently added '10.0.0.8' (ED25519) to the list of known hosts.\r\n" +
          'root@10.0.0.8: Permission denied (publickey,password).\r\n',
        255
      )
    ).toBe('root@10.0.0.8: Permission denied (publickey,password).')
  })

  it('没有输出时给退出代码', () => {
    expect(sshFailureMessage('  \n', 255)).toBe('连接失败（退出代码 255）')
    expect(sshFailureMessage('', null)).toBe('连接失败')
  })
})

describe('manualTargetError', () => {
  it('合法', () => {
    expect(manualTargetError(manual())).toBeNull()
    expect(manualTargetError(manual({ user: '' }))).toBeNull()
  })

  it('地址必填且不能像选项或夹带用户名', () => {
    expect(manualTargetError(manual({ host: '' }))).toBe('请填写地址')
    expect(manualTargetError(manual({ host: '-oProxyCommand=x' }))).toBe('地址格式不正确')
    expect(manualTargetError(manual({ host: 'a@b' }))).toBe('地址格式不正确')
  })

  it('端口范围', () => {
    expect(manualTargetError(manual({ port: 0 }))).toBe('端口应为 1–65535 的整数')
    expect(manualTargetError(manual({ port: 70000 }))).toBe('端口应为 1–65535 的整数')
    expect(manualTargetError(manual({ port: 22.5 }))).toBe('端口应为 1–65535 的整数')
  })
})

describe('connectableHostAliases', () => {
  it('跳过通配符与取反模式', () => {
    expect(connectableHostAliases(['prod', '*', 'web-?', '!bastion', 'db.internal'])).toEqual([
      'prod',
      'db.internal'
    ])
  })
})

describe('sameServerTarget', () => {
  it('别名比别名；手填比地址、用户、端口、私钥', () => {
    expect(sameServerTarget({ kind: 'config', alias: 'a' }, { kind: 'config', alias: 'a' })).toBe(
      true
    )
    expect(sameServerTarget({ kind: 'config', alias: 'a' }, manual())).toBe(false)
    expect(sameServerTarget(manual(), manual())).toBe(true)
    expect(sameServerTarget(manual(), manual({ port: 2222 }))).toBe(false)
    expect(sameServerTarget(manual(), manual({ identityFile: '/k' }))).toBe(false)
  })
})
