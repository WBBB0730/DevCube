import { describe, expect, it } from 'vitest'
import {
  mergeTerminalTabs,
  resolvePersistedProjectPath,
  resolvePersistedSelectedKey,
  terminalsToShellsByProject
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
      { key: 'terminal:a', projectPath: '/p', name: '构建' },
      { key: 'terminal:b', projectPath: '/p', name: '终端 (2)' }
    ])
  })

  it('活会话优先：盘上名字盖到活 key；仅活着的追加', () => {
    expect(
      mergeTerminalTabs(
        [
          { key: 'terminal:a', projectPath: '/p' },
          { key: 'terminal:live', projectPath: '/p' }
        ],
        {
          '/p': [{ id: 'terminal:a', name: '改过名' }]
        }
      )
    ).toEqual([
      { key: 'terminal:a', projectPath: '/p', name: '改过名' },
      { key: 'terminal:live', projectPath: '/p', name: '终端 (2)' }
    ])
  })

  it('多项目互不干扰', () => {
    const tabs = mergeTerminalTabs([{ key: 'terminal:x', projectPath: '/a' }], {
      '/b': [{ id: 'terminal:y', name: 'Y' }]
    })
    expect(tabs).toEqual([
      { key: 'terminal:y', projectPath: '/b', name: 'Y' },
      { key: 'terminal:x', projectPath: '/a', name: '终端' }
    ])
  })
})

describe('terminalsToShellsByProject', () => {
  it('按项目分组并保留序', () => {
    expect(
      terminalsToShellsByProject([
        { key: 'terminal:1', projectPath: '/a', name: 'A1' },
        { key: 'terminal:2', projectPath: '/b', name: 'B' },
        { key: 'terminal:3', projectPath: '/a', name: 'A2' }
      ])
    ).toEqual({
      '/a': [
        { id: 'terminal:1', name: 'A1' },
        { id: 'terminal:3', name: 'A2' }
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

describe('resolvePersistedProjectPath', () => {
  it('路径仍在则保留', () => {
    expect(resolvePersistedProjectPath('/p', new Set(['/p']))).toBe('/p')
  })

  it('缺失回落 null', () => {
    expect(resolvePersistedProjectPath('/gone', new Set(['/p']))).toBe(null)
  })
})
