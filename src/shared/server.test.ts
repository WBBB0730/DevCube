import { describe, expect, it } from 'vitest'
import {
  askpassAction,
  askpassRememberDefault,
  classifyAskpassPrompt,
  connectableHostAliases,
  manualTargetError,
  parseSshEffectiveConfig,
  sameServerTarget,
  serverTargetLabel,
  sshArgs,
  sshFailureMessage,
  sshRunArgs,
  sshTestArgs,
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

  it('手填：非默认端口与私钥用选项给出', () => {
    expect(sshArgs(manual())).toEqual(['--', 'root@10.0.0.8'])
    expect(sshArgs(manual({ port: 2222, identityFile: '/k/id', user: '' }))).toEqual([
      '-p',
      '2222',
      '-i',
      '/k/id',
      '--',
      '10.0.0.8'
    ])
  })

  it('额外选项排在最前（-- 之前）', () => {
    expect(sshArgs(manual({ port: 2222 }), ['-o', 'BindAddress=192.168.1.2'])).toEqual([
      '-o',
      'BindAddress=192.168.1.2',
      '-p',
      '2222',
      '--',
      'root@10.0.0.8'
    ])
    expect(sshArgs({ kind: 'config', alias: 'prod' }, ['-o', 'BindAddress=192.168.1.2'])).toEqual([
      '-o',
      'BindAddress=192.168.1.2',
      '--',
      'prod'
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

describe('sshTestArgs / sshRunArgs', () => {
  it('测试连接：不读标准输入，10 秒连接超时，登录后立即 exit', () => {
    expect(sshTestArgs({ kind: 'config', alias: 'prod' })).toEqual([
      '-n',
      '-o',
      'ConnectTimeout=10',
      '--',
      'prod',
      'exit'
    ])
  })

  it('在服务器上执行：-t 分配远端终端，命令作为目标之后的一个参数', () => {
    expect(sshRunArgs(manual({ port: 2222 }), 'uptime')).toEqual([
      '-t',
      '-p',
      '2222',
      '--',
      'root@10.0.0.8',
      'uptime'
    ])
  })

  it('额外选项同样排在目标之前', () => {
    const options = ['-o', 'BindAddress=192.168.1.2']
    expect(sshTestArgs({ kind: 'config', alias: 'prod' }, options)).toEqual([
      '-n',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'BindAddress=192.168.1.2',
      '--',
      'prod',
      'exit'
    ])
    expect(sshRunArgs({ kind: 'config', alias: 'prod' }, 'uptime', options)).toEqual([
      '-t',
      '-o',
      'BindAddress=192.168.1.2',
      '--',
      'prod',
      'uptime'
    ])
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

describe('classifyAskpassPrompt', () => {
  it('首次连接的主机指纹确认', () => {
    expect(
      classifyAskpassPrompt(
        "The authenticity of host 'example.com (93.184.216.34)' can't be established.\n" +
          'ED25519 key fingerprint is SHA256:abc.\n' +
          'This key is not known by any other names.\n' +
          'Are you sure you want to continue connecting (yes/no/[fingerprint])? '
      )
    ).toBe('confirm')
  })

  it('密码：password 认证与 keyboard-interactive 两种写法，含中文', () => {
    expect(classifyAskpassPrompt("root@10.0.0.8's password: ")).toBe('password')
    expect(classifyAskpassPrompt('(root@10.0.0.8) Password: ')).toBe('password')
    expect(classifyAskpassPrompt('密码：')).toBe('password')
  })

  it('私钥口令与验证码不算密码', () => {
    expect(classifyAskpassPrompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519': ")).toBe(
      'secret'
    )
    expect(classifyAskpassPrompt('Verification code: ')).toBe('secret')
  })
})

describe('askpassAction', () => {
  it('密码提问：有可自动作答的密码且本次连接还没用过时自动作答', () => {
    expect(askpassAction('password', true, false, false)).toBe('answer')
    expect(askpassAction('password', true, false, true)).toBe('answer')
  })

  it('密码被拒或没有密码：正常连接转给用户，测试连接拒答', () => {
    expect(askpassAction('password', true, true, false)).toBe('ask')
    expect(askpassAction('password', false, false, false)).toBe('ask')
    expect(askpassAction('password', true, true, true)).toBe('refuse')
    expect(askpassAction('password', false, false, true)).toBe('refuse')
  })

  it('其余提问一律转给用户，测试连接也是', () => {
    expect(askpassAction('secret', true, false, false)).toBe('ask')
    expect(askpassAction('confirm', true, false, true)).toBe('ask')
    expect(askpassAction('secret', false, false, true)).toBe('ask')
  })
})

describe('askpassRememberDefault', () => {
  it('第一次问密码时不勾', () => {
    expect(askpassRememberDefault(null, false)).toBe(false)
  })

  it('自动填入的记住的密码被拒后重问：算作勾着', () => {
    expect(askpassRememberDefault(null, true)).toBe(true)
  })

  it('用户答错后重问：沿用他上一次的勾选', () => {
    expect(askpassRememberDefault(true, false)).toBe(true)
    expect(askpassRememberDefault(false, false)).toBe(false)
    expect(askpassRememberDefault(false, true)).toBe(false)
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

describe('parseSshEffectiveConfig', () => {
  it('取 hostname / user / port，首个值为准', () => {
    const output = [
      'host prod',
      'user deploy',
      'hostname 10.0.0.8',
      'port 2222',
      'identityfile ~/.ssh/id_ed25519',
      'identityfile ~/.ssh/id_rsa'
    ].join('\n')
    expect(parseSshEffectiveConfig('prod', output)).toEqual({
      alias: 'prod',
      hostName: '10.0.0.8',
      user: 'deploy',
      port: 2222
    })
  })

  it('缺项回落：地址用别名、端口 22', () => {
    expect(parseSshEffectiveConfig('box', 'user me\r\n')).toEqual({
      alias: 'box',
      hostName: 'box',
      user: 'me',
      port: 22
    })
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
