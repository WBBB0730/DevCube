import { describe, expect, it } from 'vitest'
import {
  expandSshTokens,
  expandTilde,
  orderedAlgorithms,
  jumpHopArgs,
  parseProxyJump,
  parseSshConfigHost,
  parseSshHostConfig,
  sessionEnvOf,
  preferKnownHostKeyAlgorithms
} from './ssh-config'

// OpenSSH 9.9 `ssh -G` 的输出（节选，顺序照原样）
const OUTPUT = `host tencent-hk
user ubuntu
hostname 43.161.226.97
port 22
addressfamily any
batchmode no
compression no
identitiesonly no
kbdinteractiveauthentication yes
passwordauthentication yes
pubkeyauthentication true
hashknownhosts no
stricthostkeychecking ask
numberofpasswordprompts 3
serveralivecountmax 3
serveraliveinterval 0
ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes128-gcm@openssh.com
hostkeyalgorithms ssh-ed25519-cert-v01@openssh.com,ssh-ed25519,rsa-sha2-512,rsa-sha2-256
kexalgorithms sntrup761x25519-sha512,mlkem768x25519-sha256,curve25519-sha256
macs umac-64-etm@openssh.com,hmac-sha2-256-etm@openssh.com
identityfile ~/.ssh/id_rsa
identityfile ~/.ssh/id_ecdsa
identityfile ~/.ssh/id_ed25519
globalknownhostsfile /etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2
userknownhostsfile /Users/me/.ssh/known_hosts /Users/me/.ssh/known_hosts2
sendenv LANG
sendenv LC_*
connecttimeout none
`

describe('parseSshHostConfig', () => {
  it('取连接目标、私钥（按配置顺序）、known_hosts 文件与算法列表', () => {
    const config = parseSshHostConfig(OUTPUT)
    expect(config).toMatchObject({
      hostName: '43.161.226.97',
      port: 22,
      user: 'ubuntu',
      identityFiles: ['~/.ssh/id_rsa', '~/.ssh/id_ecdsa', '~/.ssh/id_ed25519'],
      identitiesOnly: false,
      identityAgent: null,
      numberOfPasswordPrompts: 3,
      batchMode: false,
      strictHostKeyChecking: 'ask',
      userKnownHostsFiles: ['/Users/me/.ssh/known_hosts', '/Users/me/.ssh/known_hosts2'],
      globalKnownHostsFiles: ['/etc/ssh/ssh_known_hosts', '/etc/ssh/ssh_known_hosts2'],
      hashKnownHosts: false,
      hostKeyAlias: null,
      proxyJump: null,
      proxyCommand: null,
      serverAliveInterval: 0,
      serverAliveCountMax: 3,
      connectTimeout: null,
      compression: false,
      hasCertificateFile: false
    })
    expect(config.kexAlgorithms).toEqual([
      'sntrup761x25519-sha512',
      'mlkem768x25519-sha256',
      'curve25519-sha256'
    ])
  })

  it('认证顺序：默认顺序去掉 GSSAPI 与 hostbased', () => {
    expect(parseSshHostConfig(OUTPUT).authMethods).toEqual([
      'publickey',
      'keyboard-interactive',
      'password'
    ])
  })

  it('认证顺序：按 PreferredAuthentications，去掉关闭了的', () => {
    const config = parseSshHostConfig(
      'preferredauthentications password,publickey,keyboard-interactive\npubkeyauthentication false\nkbdinteractiveauthentication no\n'
    )
    expect(config.authMethods).toEqual(['password'])
    expect(
      parseSshHostConfig('pubkeyauthentication host-bound\n').authMethods.includes('publickey')
    ).toBe(true)
  })

  it('StrictHostKeyChecking 的几种写法', () => {
    const strict = (v: string): string =>
      parseSshHostConfig(`stricthostkeychecking ${v}\n`).strictHostKeyChecking
    expect(strict('true')).toBe('yes')
    expect(strict('false')).toBe('no')
    expect(strict('accept-new')).toBe('accept-new')
    expect(strict('ask')).toBe('ask')
  })

  it('SendEnv 每行一个模式、SetEnv 每行一对、RemoteCommand', () => {
    const config = parseSshHostConfig(
      'sendenv LANG\nsendenv LC_*\nsetenv FOO=bar\nsetenv BAZ=q x=1\nremotecommand tmux attach\n'
    )
    expect(config.sendEnv).toEqual(['LANG', 'LC_*'])
    expect(config.setEnv).toEqual({ FOO: 'bar', BAZ: 'q x=1' })
    expect(config.remoteCommand).toBe('tmux attach')
    expect(parseSshHostConfig(OUTPUT).remoteCommand).toBeNull()
  })

  it('可选项：设了取值，none 为未设置；Compression yes 输出为 UNKNOWN 也算开', () => {
    const config = parseSshHostConfig(
      'hostkeyalias prod\nproxyjump a@b:2222,c\nproxycommand nc %h %p\nbindaddress 192.168.1.2\nidentityagent none\nconnecttimeout 7\ncompression UNKNOWN\naddressfamily inet\ncertificatefile ~/.ssh/id-cert.pub\n'
    )
    expect(config).toMatchObject({
      hostKeyAlias: 'prod',
      proxyJump: 'a@b:2222,c',
      proxyCommand: 'nc %h %p',
      bindAddress: '192.168.1.2',
      identityAgent: 'none',
      connectTimeout: 7,
      compression: true,
      addressFamily: 'inet',
      hasCertificateFile: true
    })
  })
})

describe('parseSshConfigHost', () => {
  it('取 hostname / user / port', () => {
    expect(parseSshConfigHost('tencent-hk', OUTPUT)).toEqual({
      alias: 'tencent-hk',
      hostName: '43.161.226.97',
      user: 'ubuntu',
      port: 22
    })
  })

  it('读不到（ssh -G 失败）时地址用别名、端口 22', () => {
    expect(parseSshConfigHost('box', '')).toEqual({
      alias: 'box',
      hostName: 'box',
      user: '',
      port: 22
    })
  })
})

describe('sessionEnvOf', () => {
  it('本机环境里名字匹配 SendEnv 的传过去，SetEnv 照传且同名优先', () => {
    const env = sessionEnvOf(
      { sendEnv: ['LANG', 'LC_*'], setEnv: { LC_ALL: 'C', TZ: 'UTC' } },
      { LANG: 'zh_CN.UTF-8', LC_CTYPE: 'UTF-8', LC_ALL: 'en_US.UTF-8', PATH: '/bin', LANGX: 'x' }
    )
    expect(env).toEqual({ LANG: 'zh_CN.UTF-8', LC_CTYPE: 'UTF-8', LC_ALL: 'C', TZ: 'UTC' })
  })

  it('没有 SendEnv 时只传 SetEnv', () => {
    expect(sessionEnvOf({ sendEnv: [], setEnv: {} }, { LANG: 'zh_CN.UTF-8' })).toEqual({})
  })
})

describe('expandSshTokens / expandTilde', () => {
  const tokens = { h: 'example.com', p: '2222', r: 'root', d: '/Users/me' }

  it('展开令牌，%% 为 %', () => {
    expect(expandSshTokens('nc %h %p', tokens)).toBe('nc example.com 2222')
    expect(expandSshTokens('%d/.ssh/id_%r_%%', tokens)).toBe('/Users/me/.ssh/id_root_%')
  })

  it('认不出的令牌报错，同 OpenSSH', () => {
    expect(() => expandSshTokens('x %z', tokens)).toThrow('%z')
    expect(() => expandSshTokens('x %', tokens)).toThrow()
  })

  it('~ 与 ~/ 展开到用户目录，~user 原样', () => {
    expect(expandTilde('~', '/Users/me')).toBe('/Users/me')
    expect(expandTilde('~/.ssh/id_rsa', '/Users/me')).toBe('/Users/me/.ssh/id_rsa')
    expect(expandTilde('~bob/key', '/Users/me')).toBe('~bob/key')
  })
})

describe('parseProxyJump / jumpHopArgs', () => {
  it('逗号分隔，各跳可带用户与端口', () => {
    expect(parseProxyJump('a@b:2222, c')).toEqual([
      { host: 'b', user: 'a', port: 2222 },
      { host: 'c', user: null, port: null }
    ])
  })

  it('ssh:// 写法与 IPv6 地址', () => {
    expect(parseProxyJump('ssh://u@h:22')).toEqual([{ host: 'h', user: 'u', port: 22 }])
    expect(parseProxyJump('[::1]:2200')).toEqual([{ host: '::1', user: null, port: 2200 }])
    expect(parseProxyJump('fe80::1')).toEqual([{ host: 'fe80::1', user: null, port: null }])
  })

  it('跳板的 ssh -G 参数：写了的用选项给出', () => {
    expect(jumpHopArgs({ host: 'b', user: 'a', port: 2222 })).toEqual([
      '-l',
      'a',
      '-p',
      '2222',
      '--',
      'b'
    ])
    expect(jumpHopArgs({ host: 'c', user: null, port: null })).toEqual(['--', 'c'])
  })
})

describe('算法', () => {
  it('按用户的顺序：先清空默认列表，再逐个按名字精确追加', () => {
    const rule = orderedAlgorithms(['aes128-ctr', 'aes128-gcm@openssh.com'])!
    expect(rule.remove.every((re) => re.test('anything'))).toBe(true)
    expect(rule.append.map((re) => re.test('aes128-ctr'))).toEqual([true, false])
    expect(rule.append[1]!.test('aes128-gcm@openssh.com')).toBe(true)
    // 名字里的点不当通配
    expect(rule.append[1]!.test('aes128-gcmXopenssh.com')).toBe(false)
    expect(rule.append[0]!.test('aes128-ctr-x')).toBe(false)
  })

  it('没有列表时用默认', () => {
    expect(orderedAlgorithms([])).toBeUndefined()
  })

  it('known_hosts 里已有的密钥类型排到最前（RSA 对应三种签名）', () => {
    const list = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256']
    expect(preferKnownHostKeyAlgorithms(list, ['ssh-rsa'])).toEqual([
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-ed25519',
      'ecdsa-sha2-nistp256'
    ])
    expect(preferKnownHostKeyAlgorithms(list, [])).toEqual(list)
  })
})
