import { describe, expect, it } from 'vitest'
import {
  orderedTabKeysOf,
  resolveActiveTabKey,
  resolveDefaultActiveKey,
  resolveNeighborAfterClose
} from './tab-activation'

describe('resolveDefaultActiveKey', () => {
  const base = {
    residentKeys: ['git:/p', 'files:/p'],
    termTabs: [{ key: 'terminal:1' }],
    termTabsFirst: false
  }

  it('有运行中会话时取第一个运行中的', () => {
    expect(
      resolveDefaultActiveKey({
        ...base,
        runTabs: [
          { key: 'run:a', status: 'exited' },
          { key: 'run:b', status: 'running' },
          { key: 'run:c', status: 'running' }
        ]
      })
    ).toBe('run:b')
  })

  it('无运行中时落 Git（Tab 序首位）', () => {
    expect(
      resolveDefaultActiveKey({
        ...base,
        runTabs: [{ key: 'run:a', status: 'exited' }]
      })
    ).toBe('git:/p')
  })

  it('Server 条目：Tab 序为 Status → Files → 运行会话 → 终端', () => {
    expect(
      orderedTabKeysOf({
        residentKeys: ['status:server:s1', 'files:server:s1'],
        runTabs: [{ key: 'run:a', status: 'exited' }],
        termTabs: [{ key: 'ssh:1' }],
        termTabsFirst: false
      })
    ).toEqual(['status:server:s1', 'files:server:s1', 'run:a', 'ssh:1'])
  })

  it('Server 条目：无运行中时落 Status Tab；有运行中的会话仍优先', () => {
    const server = {
      residentKeys: ['status:server:s1', 'files:server:s1'],
      termTabs: [{ key: 'ssh:1' }],
      termTabsFirst: false
    }
    expect(resolveDefaultActiveKey({ ...server, runTabs: [] })).toBe('status:server:s1')
    expect(
      resolveDefaultActiveKey({ ...server, runTabs: [{ key: 'run:a', status: 'running' }] })
    ).toBe('run:a')
  })

  it('一个 Tab 都没有时为 null', () => {
    expect(
      resolveDefaultActiveKey({ residentKeys: [], runTabs: [], termTabs: [], termTabsFirst: false })
    ).toBeNull()
  })
})

describe('Data Source 条目的 Tab 序（终端组在前）', () => {
  const dataSource = {
    residentKeys: ['db:datasource:d1'],
    runTabs: [
      { key: 'run:a', status: 'exited' as const },
      { key: 'run:b', status: 'running' as const }
    ],
    termTabs: [{ key: 'db-tab:1' }, { key: 'db-tab:2' }],
    termTabsFirst: true
  }
  const ordered = orderedTabKeysOf(dataSource)

  it('常驻数据源 Tab → 另开的数据源 Tab（组内顺序照旧）→ 运行会话', () => {
    expect(ordered).toEqual(['db:datasource:d1', 'db-tab:1', 'db-tab:2', 'run:a', 'run:b'])
  })

  it('默认激活仍是第一个运行中的会话，没有时为常驻数据源 Tab', () => {
    expect(resolveDefaultActiveKey(dataSource)).toBe('run:b')
    expect(resolveDefaultActiveKey({ ...dataSource, runTabs: [] })).toBe('db:datasource:d1')
  })

  it('关闭后按新顺序回落左邻', () => {
    // 第一个运行会话的左邻是最后一个另开的数据源 Tab
    expect(resolveNeighborAfterClose(ordered, 'run:a')).toBe('db-tab:2')
    // 第一个另开的数据源 Tab 的左邻是常驻数据源 Tab
    expect(resolveNeighborAfterClose(ordered, 'db-tab:1')).toBe('db:datasource:d1')
  })
})

describe('resolveActiveTabKey', () => {
  const base = {
    residentKeys: ['git:/p', 'files:/p'],
    runTabs: [{ key: 'run:a', status: 'running' as const }],
    termTabs: [] as { key: string }[],
    termTabsFirst: false
  }

  it('显式有效键优先', () => {
    expect(resolveActiveTabKey({ ...base, stored: 'files:/p' })).toBe('files:/p')
  })

  it('未接触过走默认（运行中优先）', () => {
    expect(resolveActiveTabKey({ ...base, stored: undefined })).toBe('run:a')
  })

  it('失效键走默认', () => {
    expect(resolveActiveTabKey({ ...base, stored: 'run:gone' })).toBe('run:a')
  })
})

describe('resolveNeighborAfterClose', () => {
  it('关中间落到左邻', () => {
    expect(resolveNeighborAfterClose(['g', 'f', 'r', 't'], 'r')).toBe('f')
  })

  it('关最左落到新的最左', () => {
    expect(resolveNeighborAfterClose(['g', 'f', 'r'], 'g')).toBe('f')
  })
})
