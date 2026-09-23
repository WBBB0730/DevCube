import { describe, expect, it } from 'vitest'
import type { FilesDirEntry } from './files'
import {
  FILES_TYPE_CATEGORIES,
  filesTypeCategory,
  filterFilesEntriesByType,
  filterFilesTreeByType,
  isFilesTypeFilterActive
} from './files-type-filter'

const entry = (name: string, isDirectory = false): FilesDirEntry => ({
  name,
  path: `/root/${name}`,
  isDirectory
})

describe('filesTypeCategory', () => {
  it('按扩展名归类；svg 算图片；PPT 含放映版 / 模板 / 带宏变体；音视频按可播容器表', () => {
    expect(filesTypeCategory('a.png')).toBe('image')
    expect(filesTypeCategory('icon.SVG')).toBe('image')
    expect(filesTypeCategory('spec.pdf')).toBe('pdf')
    expect(filesTypeCategory('deck.pptx')).toBe('pptx')
    expect(filesTypeCategory('show.PPSX')).toBe('pptx')
    expect(filesTypeCategory('macro.pptm')).toBe('pptx')
    expect(filesTypeCategory('clip.mp4')).toBe('av')
    expect(filesTypeCategory('track.flac')).toBe('av')
    expect(filesTypeCategory('app.ts')).toBe('text')
    expect(filesTypeCategory('Dockerfile')).toBe('text')
  })

  it('未知扩展名 / 无扩展名 / 不可播容器归其他', () => {
    expect(filesTypeCategory('a.wasm')).toBe('other')
    expect(filesTypeCategory('noext')).toBe('other')
    expect(filesTypeCategory('movie.mkv')).toBe('other')
    expect(filesTypeCategory('old.ppt')).toBe('other')
  })
})

describe('filterFilesEntriesByType', () => {
  const entries = [entry('src', true), entry('a.png'), entry('b.pdf'), entry('c.ts')]

  it('全选即未筛选，返回同一引用', () => {
    const all = new Set(FILES_TYPE_CATEGORIES)
    expect(isFilesTypeFilterActive(all)).toBe(false)
    expect(filterFilesEntriesByType(entries, all)).toBe(entries)
  })

  it('目录恒保留，文件只留勾选类别', () => {
    const only = new Set(['image'] as const)
    expect(filterFilesEntriesByType(entries, only).map((e) => e.name)).toEqual(['src', 'a.png'])
  })
})

describe('filterFilesTreeByType', () => {
  it('逐层套用；未筛选时返回原映射引用', () => {
    const tree = { '/root': [entry('src', true), entry('a.png')], '/root/src': [entry('x.ts')] }
    expect(filterFilesTreeByType(tree, new Set(FILES_TYPE_CATEGORIES))).toBe(tree)
    const filtered = filterFilesTreeByType(tree, new Set(['text'] as const))
    expect(filtered['/root'].map((e) => e.name)).toEqual(['src'])
    expect(filtered['/root/src'].map((e) => e.name)).toEqual(['x.ts'])
  })
})
