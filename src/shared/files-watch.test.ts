import { describe, expect, it } from 'vitest'
import { mergeReloadedDirs, resolveOpenTextDiskSync, sameDirEntries } from './files-watch'
import type { FilesDirEntry } from './files'

function entry(name: string, path: string, isDirectory = false): FilesDirEntry {
  return { name, path, isDirectory }
}

describe('sameDirEntries', () => {
  it('相等则 true', () => {
    const a = [entry('a', '/p/a'), entry('b', '/p/b', true)]
    const b = [entry('a', '/p/a'), entry('b', '/p/b', true)]
    expect(sameDirEntries(a, b)).toBe(true)
  })

  it('顺序或字段不同则 false', () => {
    expect(sameDirEntries([entry('a', '/p/a')], [entry('b', '/p/b')])).toBe(false)
    expect(sameDirEntries([entry('a', '/p/a')], [entry('a', '/p/a', true)])).toBe(false)
  })
})

describe('mergeReloadedDirs', () => {
  it('无变化保留原对象引用', () => {
    const prev = { '/p': [entry('a', '/p/a')] }
    const next = mergeReloadedDirs(prev, { '/p': [entry('a', '/p/a')] })
    expect(next).toBe(prev)
  })

  it('有变化替换对应目录', () => {
    const prev = { '/p': [entry('a', '/p/a')] }
    const next = mergeReloadedDirs(prev, { '/p': [entry('a', '/p/a'), entry('b', '/p/b')] })
    expect(next).not.toBe(prev)
    expect(next['/p']).toHaveLength(2)
  })

  it('列举失败移除该目录及其后代缓存', () => {
    const prev = {
      '/p': [entry('src', '/p/src', true)],
      '/p/src': [entry('a.ts', '/p/src/a.ts')],
      '/p/src/nested': [entry('b.ts', '/p/src/nested/b.ts')]
    }
    const next = mergeReloadedDirs(prev, { '/p/src': null })
    expect(next['/p']).toEqual(prev['/p'])
    expect(next['/p/src']).toBeUndefined()
    expect(next['/p/src/nested']).toBeUndefined()
  })
})

describe('resolveOpenTextDiskSync', () => {
  const loaded = { path: '/p/a.ts', mtimeMs: 10, dirty: false }

  it('mtime 未变 → noop', () => {
    expect(
      resolveOpenTextDiskSync(loaded, {
        kind: 'text',
        path: '/p/a.ts',
        content: 'x',
        mtimeMs: 10
      })
    ).toEqual({ action: 'noop' })
  })

  it('无脏且 mtime 变 → reload', () => {
    expect(
      resolveOpenTextDiskSync(loaded, {
        kind: 'text',
        path: '/p/a.ts',
        content: 'y',
        mtimeMs: 20
      })
    ).toEqual({ action: 'reload', content: 'y', mtimeMs: 20 })
  })

  it('有脏且 mtime 变 → conflict', () => {
    expect(
      resolveOpenTextDiskSync(
        { ...loaded, dirty: true },
        { kind: 'text', path: '/p/a.ts', content: 'y', mtimeMs: 20 }
      )
    ).toEqual({ action: 'conflict', disk: 'y', mtimeMs: 20 })
  })

  it('读失败 → gone', () => {
    expect(resolveOpenTextDiskSync(loaded, null)).toEqual({ action: 'gone' })
  })

  it('种类不再是文本 → reopen', () => {
    expect(
      resolveOpenTextDiskSync(loaded, { kind: 'image', path: '/p/a.ts', dataUrl: 'data:' })
    ).toEqual({ action: 'reopen' })
  })
})
