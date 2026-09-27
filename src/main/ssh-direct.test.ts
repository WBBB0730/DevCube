import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  buildDirectOptions,
  directTargetOf,
  knownHostsName,
  parsePrimaryInterface,
  parseScopedDnsServers,
  parseWindowsNetwork,
  usableIPv4Of
} from './ssh-direct'

describe('directTargetOf', () => {
  it('取 ssh 最终要连的主机名与端口', () => {
    expect(directTargetOf('user root\nhostname pj.example.com\nport 2222\n')).toEqual({
      hostName: 'pj.example.com',
      port: 2222,
      hostKeyAlias: null
    })
  })

  it('带上用户自设的 HostKeyAlias', () => {
    expect(directTargetOf('hostname 10.0.0.5\nport 22\nhostkeyalias prod\n')?.hostKeyAlias).toBe(
      'prod'
    )
  })

  it('用户配置自行指定了连接路径时不插手', () => {
    for (const line of [
      'proxyjump bastion',
      'proxycommand nc %h %p',
      'bindaddress 192.168.1.2',
      'bindinterface en0'
    ]) {
      expect(directTargetOf(`hostname a.example.com\nport 22\n${line}\n`)).toBeNull()
    }
  })
})

describe('knownHostsName', () => {
  it('22 端口为主机名，其余为 [主机名]:端口（同 ssh 的写法）', () => {
    expect(knownHostsName('a.example.com', 22)).toBe('a.example.com')
    expect(knownHostsName('a.example.com', 2222)).toBe('[a.example.com]:2222')
  })
})

describe('buildDirectOptions', () => {
  const target = { hostName: 'a.example.com', port: 2222, hostKeyAlias: null }

  it('目标已是 IP：只绑定实体网卡的地址', () => {
    expect(buildDirectOptions({ ...target, hostName: '10.0.0.5' }, '192.168.31.32', null)).toEqual([
      '-o',
      'BindAddress=192.168.31.32'
    ])
  })

  it('目标是域名：改连真实地址，known_hosts 仍按原主机名核对', () => {
    expect(buildDirectOptions(target, '192.168.31.32', '20.205.243.166')).toEqual([
      '-o',
      'BindAddress=192.168.31.32',
      '-o',
      'HostName=20.205.243.166',
      '-o',
      'HostKeyAlias=[a.example.com]:2222'
    ])
  })

  it('用户已自设 HostKeyAlias：沿用，不再追加', () => {
    expect(
      buildDirectOptions({ ...target, hostKeyAlias: 'prod' }, '192.168.31.32', '20.205.243.166')
    ).toEqual(['-o', 'BindAddress=192.168.31.32', '-o', 'HostName=20.205.243.166'])
  })
})

describe('usableIPv4Of', () => {
  const info = (
    address: string,
    family: 'IPv4' | 'IPv6',
    internal = false
  ): NetworkInterfaceInfo =>
    family === 'IPv4'
      ? { address, family, internal, netmask: '255.255.255.0', mac: '', cidr: null }
      : { address, family, internal, netmask: 'ffff::', mac: '', cidr: null, scopeid: 0 }

  it('跳过 IPv6、回环与 169.254 自动分配地址', () => {
    expect(
      usableIPv4Of([
        info('fe80::1', 'IPv6'),
        info('127.0.0.1', 'IPv4', true),
        info('169.254.10.2', 'IPv4'),
        info('192.168.31.32', 'IPv4')
      ])
    ).toBe('192.168.31.32')
  })

  it('没有可用地址或网卡不存在时为 null', () => {
    expect(usableIPv4Of([info('169.254.10.2', 'IPv4')])).toBeNull()
    expect(usableIPv4Of(undefined)).toBeNull()
  })
})

describe('parsePrimaryInterface', () => {
  it('从 State:/Network/Global/IPv4 取主网卡名', () => {
    const output = [
      '<dictionary> {',
      '  PrimaryInterface : en0',
      '  PrimaryService : 34202332-AFE3-4794-BBA4-B6FED81D2AA8',
      '  Router : 192.168.31.1',
      '}'
    ].join('\n')
    expect(parsePrimaryInterface(output)).toBe('en0')
  })

  it('没有网络时（键不存在）为 null', () => {
    expect(parsePrimaryInterface('  No such key\n')).toBeNull()
  })
})

describe('parseScopedDnsServers', () => {
  const output = [
    'DNS configuration',
    '',
    'resolver #1',
    '  nameserver[0] : 198.18.0.2',
    '  flags    : Request A records',
    '',
    'DNS configuration (for scoped queries)',
    '',
    'resolver #1',
    '  nameserver[0] : 114.114.114.114',
    '  nameserver[1] : fe80::1%en0',
    '  if_index : 14 (en0)',
    '  flags    : Scoped, Request A records',
    '',
    'resolver #2',
    '  nameserver[0] : 192.168.1.1',
    '  if_index : 22 (en5)',
    '  flags    : Scoped, Request A records'
  ].join('\n')

  it('只取限定到该网卡的解析器，不取全局的；只要 IPv4', () => {
    expect(parseScopedDnsServers(output, 'en0')).toEqual(['114.114.114.114'])
    expect(parseScopedDnsServers(output, 'en5')).toEqual(['192.168.1.1'])
  })

  it('该网卡没有限定的解析器时为空', () => {
    expect(parseScopedDnsServers(output, 'utun4')).toEqual([])
  })
})

describe('parseWindowsNetwork', () => {
  it('取第一个可用地址与全部 IPv4 DNS', () => {
    expect(
      parseWindowsNetwork(
        'address 169.254.3.4\r\naddress 192.168.1.5\r\ndns 192.168.1.1\r\ndns 8.8.8.8\r\n'
      )
    ).toEqual({ address: '192.168.1.5', dnsServers: ['192.168.1.1', '8.8.8.8'] })
  })

  it('没有输出（找不到实体网卡）或没有可用地址时为 null', () => {
    expect(parseWindowsNetwork('')).toBeNull()
    expect(parseWindowsNetwork('address 169.254.3.4\r\ndns 192.168.1.1\r\n')).toBeNull()
  })
})
