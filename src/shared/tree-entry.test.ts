import { describe, expect, it } from 'vitest'
import { configOwnerKey, isServerEntryKey, serverEntryKey, serverIdOfEntryKey } from './tree-entry'

describe('条目键', () => {
  it('Server 条目键与 id 互转；绝对路径不是 Server 条目键', () => {
    expect(serverEntryKey('s1')).toBe('server:s1')
    expect(serverIdOfEntryKey('server:s1')).toBe('s1')
    expect(isServerEntryKey('/Users/me/web')).toBe(false)
    expect(serverIdOfEntryKey('C:\\code\\web')).toBeNull()
  })
})

describe('configOwnerKey', () => {
  it('服务器上的命令型属于其 Server，数据源上的属于其 Data Source，其余属于其 Project', () => {
    expect(
      configOwnerKey({ id: 'c1', kind: 'remote', serverId: 's1', name: 'logs', command: 'ls' })
    ).toBe('server:s1')
    expect(
      configOwnerKey({
        id: 'c3',
        kind: 'dataSource',
        dataSourceId: 'd1',
        name: 'clean',
        script: 'x'
      })
    ).toBe('datasource:d1')
    expect(
      configOwnerKey({ id: 'c2', kind: 'command', projectPath: '/p', name: 'dev', command: 'x' })
    ).toBe('/p')
  })
})
