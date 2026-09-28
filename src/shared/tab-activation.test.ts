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
    termTabs: [{ key: 'terminal:1' }]
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
        termTabs: [{ key: 'ssh:1' }]
      })
    ).toEqual(['status:server:s1', 'files:server:s1', 'run:a', 'ssh:1'])
  })

  it('Server 条目：无运行中时落 Status Tab；有运行中的会话仍优先', () => {
    const server = {
      residentKeys: ['status:server:s1', 'files:server:s1'],
      termTabs: [{ key: 'ssh:1' }]
    }
    expect(resolveDefaultActiveKey({ ...server, runTabs: [] })).toBe('status:server:s1')
    expect(
      resolveDefaultActiveKey({ ...server, runTabs: [{ key: 'run:a', status: 'running' }] })
    ).toBe('run:a')
  })

  it('一个 Tab 都没有时为 null', () => {
    expect(resolveDefaultActiveKey({ residentKeys: [], runTabs: [], termTabs: [] })).toBeNull()
  })
})

describe('resolveActiveTabKey', () => {
  const base = {
    residentKeys: ['git:/p', 'files:/p'],
    runTabs: [{ key: 'run:a', status: 'running' as const }],
    termTabs: [] as { key: string }[]
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
