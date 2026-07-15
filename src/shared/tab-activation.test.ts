import { describe, expect, it } from 'vitest'
import {
  resolveActiveTabKey,
  resolveDefaultActiveKey,
  resolveNeighborAfterClose
} from './tab-activation'

describe('resolveDefaultActiveKey', () => {
  const base = {
    gitKey: 'git:/p',
    filesKey: 'files:/p',
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
})

describe('resolveActiveTabKey', () => {
  const base = {
    gitKey: 'git:/p',
    filesKey: 'files:/p',
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
