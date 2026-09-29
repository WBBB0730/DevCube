import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseSshHostConfig } from '../shared/ssh-config'
import {
  directHostOf,
  parsePrimaryInterface,
  parseScopedDnsServers,
  parseWindowsNetwork,
  usableIPv4Of
} from './ssh-direct'

describe('directHostOf', () => {
  it('取 ssh 最终要连的主机名', () => {
    expect(
      directHostOf(parseSshHostConfig('user root\nhostname pj.example.com\nport 2222\n'))
    ).toBe('pj.example.com')
  })

  it('用户配置自行指定了连接路径时不插手', () => {
    for (const line of [
      'proxyjump bastion',
      'proxycommand nc %h %p',
      'bindaddress 192.168.1.2',
      'bindinterface en0'
    ]) {
      expect(
        directHostOf(parseSshHostConfig(`hostname a.example.com\nport 22\n${line}\n`))
      ).toBeNull()
    }
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
