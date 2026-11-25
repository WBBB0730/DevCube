import { describe, expect, it } from 'vitest'
import {
  filesArrowOwner,
  filesScrollStep,
  isFilesArrowKey,
  reachesContent,
  type FilesArrowContent,
  type FilesArrowKey,
  type FilesArrowOwner,
  type FilesKeyScope
} from './files-key-route'

const KEYS: FilesArrowKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const CONTENTS: FilesArrowContent[] = ['image', 'av', 'paged', null]
const USED: FilesArrowContent[] = ['image', 'av', 'paged']

const owner = (
  key: FilesArrowKey,
  scope: FilesKeyScope,
  content: FilesArrowContent,
  opts: { dir?: boolean; shift?: boolean } = {}
): FilesArrowOwner =>
  filesArrowOwner(key, opts.shift ?? false, {
    scope,
    treeRowIsDirectory: opts.dir ?? false,
    content
  })

describe('方向键归属', () => {
  it('只认四个方向键', () => {
    expect(KEYS.every(isFilesArrowKey)).toBe(true)
    expect(isFilesArrowKey('Enter')).toBe(false)
    expect(isFilesArrowKey(' ')).toBe(false)
  })

  it('↑ / ↓ 换文件，焦点在文件树上与在别处都归文件树', () => {
    for (const scope of ['tree', 'idle'] as const) {
      for (const content of CONTENTS) {
        for (const dir of [true, false]) {
          expect(owner('ArrowUp', scope, content, { dir })).toBe('tree')
          expect(owner('ArrowDown', scope, content, { dir })).toBe('tree')
        }
      }
    }
  })

  it('⇧↑ / ⇧↓ 扩选是文件树自己的操作，焦点在树上才接', () => {
    expect(owner('ArrowUp', 'tree', 'av', { shift: true })).toBe('tree')
    expect(owner('ArrowDown', 'tree', null, { shift: true })).toBe('tree')
    expect(owner('ArrowUp', 'idle', 'av', { shift: true })).toBeNull()
    expect(owner('ArrowDown', 'idle', null, { shift: true })).toBeNull()
  })

  it('← / → 文件内前后：正文用得上时两边都归正文', () => {
    for (const scope of ['tree', 'idle'] as const) {
      for (const content of USED) {
        expect(owner('ArrowLeft', scope, content)).toBe('content')
        expect(owner('ArrowRight', scope, content)).toBe('content')
      }
    }
  })

  it('焦点在文件树上：文件夹行的 ← / → 归文件树（开合），哪怕正文用得上', () => {
    for (const content of CONTENTS) {
      expect(owner('ArrowLeft', 'tree', content, { dir: true })).toBe('tree')
      expect(owner('ArrowRight', 'tree', content, { dir: true })).toBe('tree')
    }
  })

  it('焦点在文件树上：正文用不上 ← / → 时归文件树（同 WebStorm 的树）', () => {
    expect(owner('ArrowLeft', 'tree', null)).toBe('tree')
    expect(owner('ArrowRight', 'tree', null)).toBe('tree')
  })

  it('焦点不在文件树上：← / → 不碰文件树，选中行是文件夹也一样', () => {
    for (const content of USED) {
      expect(owner('ArrowLeft', 'idle', content, { dir: true })).toBe('content')
      expect(owner('ArrowRight', 'idle', content, { dir: true })).toBe('content')
    }
    expect(owner('ArrowLeft', 'idle', null)).toBeNull()
    expect(owner('ArrowRight', 'idle', null, { dir: true })).toBeNull()
  })

  it('⇧← / ⇧→ 不接', () => {
    for (const scope of ['tree', 'idle'] as const) {
      expect(owner('ArrowLeft', scope, 'av', { shift: true })).toBeNull()
      expect(owner('ArrowRight', scope, null, { shift: true, dir: true })).toBeNull()
    }
  })

  it('进了分页文档，四个方向键都归正文', () => {
    for (const key of KEYS) {
      expect(owner(key, 'content', 'paged')).toBe('content')
      expect(owner(key, 'content', 'paged', { dir: true })).toBe('content')
    }
  })

  it('进了别的正文（表格、Markdown 预览等）不接，留给它们自己', () => {
    for (const key of KEYS) {
      for (const content of ['image', 'av', null] as const) {
        expect(owner(key, 'content', content)).toBeNull()
      }
    }
  })

  it('进了正文后带 ⇧ 的方向键不接', () => {
    for (const key of KEYS) expect(owner(key, 'content', 'paged', { shift: true })).toBeNull()
  })

  it('正在输入、弹层开着时一概不接', () => {
    for (const scope of ['typing', 'blocked'] as const) {
      for (const key of KEYS) {
        for (const content of CONTENTS) {
          expect(owner(key, scope, content)).toBeNull()
          expect(owner(key, scope, content, { dir: true, shift: true })).toBeNull()
        }
      }
    }
  })
})

describe('两边一样的键', () => {
  it('焦点在文件树上或别处时到得了正文；输入、弹层、进了正文时到不了', () => {
    expect(reachesContent('tree')).toBe(true)
    expect(reachesContent('idle')).toBe(true)
    expect(reachesContent('content')).toBe(false)
    expect(reachesContent('typing')).toBe(false)
    expect(reachesContent('blocked')).toBe(false)
  })

  it.each([
    ['PageUp', false, -1],
    ['PageDown', false, 1],
    ['Home', false, 'start'],
    ['End', false, 'end'],
    [' ', false, 1],
    [' ', true, -1]
  ] as const)('翻页滚动：%s（⇧ %s）→ %s', (key, shift, step) => {
    expect(filesScrollStep(key, shift)).toBe(step)
  })

  it('别的键、带 ⇧ 的翻页键不算翻页滚动', () => {
    expect(filesScrollStep('ArrowDown', false)).toBeNull()
    expect(filesScrollStep('Enter', false)).toBeNull()
    expect(filesScrollStep('PageDown', true)).toBeNull()
    expect(filesScrollStep('Home', true)).toBeNull()
  })
})
