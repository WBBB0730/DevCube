import { describe, expect, it } from 'vitest'
import {
  mergeTerminalTabs,
  migrateLegacyWorkspaceUi,
  nextNumberedTerminalName,
  renamedTerminalName,
  resolvePersistedEntryKey,
  resolvePersistedSelectedKey,
  terminalsToShellsByEntry
} from './workspace'

describe('mergeTerminalTabs', () => {
  it('仅盘上有壳时按序保留', () => {
    expect(
      mergeTerminalTabs([], {
        '/p': [
          { id: 'terminal:a', name: '构建' },
          { id: 'terminal:b', name: '终端 (2)' }
        ]
      })
    ).toEqual([
      { key: 'terminal:a', ownerKey: '/p', name: '构建' },
      { key: 'terminal:b', ownerKey: '/p', name: '终端 (2)' }
    ])
  })

  it('活会话优先：盘上名字盖到活 key；仅活着的追加', () => {
    expect(
      mergeTerminalTabs(
        [
          { key: 'terminal:a', ownerKey: '/p' },
          { key: 'terminal:live', ownerKey: '/p' }
        ],
        {
          '/p': [{ id: 'terminal:a', name: '改过名' }]
        }
      )
    ).toEqual([
      { key: 'terminal:a', ownerKey: '/p', name: '改过名' },
      { key: 'terminal:live', ownerKey: '/p', name: '终端 (2)' }
    ])
  })

  it('多条目互不干扰', () => {
    const tabs = mergeTerminalTabs([{ key: 'terminal:x', ownerKey: '/a' }], {
      '/b': [{ id: 'terminal:y', name: 'Y' }]
    })
    expect(tabs).toEqual([
      { key: 'terminal:y', ownerKey: '/b', name: 'Y' },
      { key: 'terminal:x', ownerKey: '/a', name: '终端' }
    ])
  })

  it('SSH Terminal 保留所连服务器；仅活着的用服务器名兜底', () => {
    expect(
      mergeTerminalTabs(
        [{ key: 'ssh:live', ownerKey: 'server:s1', serverId: 's1' }],
        { 'server:s1': [{ id: 'ssh:a', name: '日志', serverId: 's1' }] },
        (id) => (id === 's1' ? 'prod' : undefined)
      )
    ).toEqual([
      { key: 'ssh:a', ownerKey: 'server:s1', name: '日志', serverId: 's1' },
      { key: 'ssh:live', ownerKey: 'server:s1', name: 'prod', serverId: 's1' }
    ])
  })
})

describe('terminalsToShellsByEntry', () => {
  it('按条目分组并保留序', () => {
    expect(
      terminalsToShellsByEntry([
        { key: 'terminal:1', ownerKey: '/a', name: 'A1' },
        { key: 'terminal:2', ownerKey: '/b', name: 'B' },
        { key: 'ssh:3', ownerKey: '/a', name: 'prod', serverId: 's1' }
      ])
    ).toEqual({
      '/a': [
        { id: 'terminal:1', name: 'A1' },
        { id: 'ssh:3', name: 'prod', serverId: 's1' }
      ],
      '/b': [{ id: 'terminal:2', name: 'B' }]
    })
  })
})

describe('resolvePersistedSelectedKey', () => {
  it('键仍在则保留', () => {
    expect(resolvePersistedSelectedKey('cmd\0x', new Set(['cmd\0x']))).toBe('cmd\0x')
  })

  it('键缺失或空回落 null', () => {
    expect(resolvePersistedSelectedKey('gone', new Set(['a']))).toBe(null)
    expect(resolvePersistedSelectedKey(null, new Set(['a']))).toBe(null)
  })
})

describe('resolvePersistedEntryKey', () => {
  it('条目仍在则保留', () => {
    expect(resolvePersistedEntryKey('/p', new Set(['/p']))).toBe('/p')
    expect(resolvePersistedEntryKey('server:s', new Set(['server:s']))).toBe('server:s')
  })

  it('缺失回落 null', () => {
    expect(resolvePersistedEntryKey('/gone', new Set(['/p']))).toBe(null)
  })
})

describe('migrateLegacyWorkspaceUi', () => {
  it('旧字段名搬到新字段名下', () => {
    expect(
      migrateLegacyWorkspaceUi({
        currentProjectPath: '/p',
        selectedKey: null,
        activeTabByProject: { '/p': 'git:/p' },
        terminalsByProject: { '/p': [{ id: 'terminal:a', name: '终端' }] }
      })
    ).toEqual({
      currentEntryKey: '/p',
      selectedKey: null,
      activeTabByEntry: { '/p': 'git:/p' },
      terminalsByEntry: { '/p': [{ id: 'terminal:a', name: '终端' }] }
    })
  })

  it('已是新字段名时不被旧字段覆盖', () => {
    expect(
      migrateLegacyWorkspaceUi({ currentEntryKey: 'server:s', currentProjectPath: '/p' })
    ).toEqual({ currentEntryKey: 'server:s' })
  })
})

describe('nextNumberedTerminalName', () => {
  it('第一个就叫 base，之后按已有最大序号 +1', () => {
    expect(nextNumberedTerminalName([], 'prod')).toBe('prod')
    expect(nextNumberedTerminalName(['prod'], 'prod')).toBe('prod (2)')
    expect(nextNumberedTerminalName(['prod', 'prod (3)'], 'prod')).toBe('prod (4)')
  })

  it('用户改过的名字与别的系列不参与编号', () => {
    expect(nextNumberedTerminalName(['看日志', 'prod-db', 'prod (x)'], 'prod')).toBe('prod')
  })

  it('服务器名里的括号与特殊字符按原样处理', () => {
    expect(nextNumberedTerminalName(['a.b (c)'], 'a.b (c)')).toBe('a.b (c) (2)')
  })
})

describe('renamedTerminalName', () => {
  it('默认名跟着改、序号保留', () => {
    expect(renamedTerminalName('prod', 'prod', '生产')).toBe('生产')
    expect(renamedTerminalName('prod (2)', 'prod', '生产')).toBe('生产 (2)')
  })

  it('用户改过的名字不动', () => {
    expect(renamedTerminalName('看日志', 'prod', '生产')).toBeNull()
  })
})
