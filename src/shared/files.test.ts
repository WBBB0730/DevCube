import { describe, expect, it } from 'vitest'
import {
  buildFilesAssetUrl,
  buildFilesMediaUrl,
  buildFilesTileUrl,
  compareFilesDirEntries,
  DEFAULT_FILES_UI,
  type FilesDirEntry,
  normalizeFilesUi,
  symlinkJumpTarget
} from './files'

describe('dc-media URL', () => {
  it('项目内文件：p / f / m 三个参数，主进程按 f 解析', () => {
    const u = new URL(buildFilesMediaUrl('/p', '/p/a b.png', 'image/png'))
    expect(u.protocol).toBe('dc-media:')
    expect(u.searchParams.get('p')).toBe('/p')
    expect(u.searchParams.get('f')).toBe('/p/a b.png')
    expect(u.searchParams.get('m')).toBe('image/png')
  })

  it('瓦片缓存：t 为键，f 相对键目录', () => {
    const u = new URL(buildFilesTileUrl('ab', 'image_files/12/3_4.jpeg', 'image/jpeg'))
    expect(u.searchParams.get('t')).toBe('ab')
    expect(u.searchParams.get('f')).toBe('image_files/12/3_4.jpeg')
  })

  it('静态资源前缀：以 / 结尾、f 在末位，可直接拼文件名后仍能解析', () => {
    const prefix = buildFilesAssetUrl('pdfjs', 'cmaps/')
    expect(prefix.endsWith('/')).toBe(true)
    expect(prefix).toBe('dc-media://local/?a=pdfjs&f=cmaps/')
    const u = new URL(`${prefix}UniGB-UCS2-H.bcmap`)
    expect(u.searchParams.get('a')).toBe('pdfjs')
    expect(u.searchParams.get('f')).toBe('cmaps/UniGB-UCS2-H.bcmap')
  })
})

describe('symlinkJumpTarget', () => {
  it('链接没断、目标在根下：给出目标', () => {
    expect(symlinkJumpTarget({ target: '/p/real', broken: false }, '/p')).toBe('/p/real')
    expect(symlinkJumpTarget({ target: '/etc/x', broken: false }, '/')).toBe('/etc/x')
  })

  it('不是链接、断链、目标在根外或就是根：null', () => {
    expect(symlinkJumpTarget(undefined, '/p')).toBeNull()
    expect(symlinkJumpTarget({ target: 'missing', broken: true }, '/p')).toBeNull()
    expect(symlinkJumpTarget({ target: '/elsewhere', broken: false }, '/p')).toBeNull()
    expect(symlinkJumpTarget({ target: '/pp/x', broken: false }, '/p')).toBeNull()
    expect(symlinkJumpTarget({ target: '/p', broken: false }, '/p')).toBeNull()
  })
})

describe('compareFilesDirEntries', () => {
  const entry = (name: string, isDirectory = false): FilesDirEntry => ({
    name,
    path: `/p/${name}`,
    isDirectory
  })

  it('目录在前；同类名称自然排序、不分大小写', () => {
    const names = [entry('v10.md'), entry('v5.md'), entry('B.md'), entry('a.md'), entry('z', true)]
      .sort(compareFilesDirEntries)
      .map((e) => e.name)
    expect(names).toEqual(['z', 'a.md', 'B.md', 'v5.md', 'v10.md'])
  })
})

describe('normalizeFilesUi', () => {
  it('形状不对的回到默认，列表只留字符串', () => {
    expect(normalizeFilesUi(undefined)).toEqual(DEFAULT_FILES_UI)
    expect(normalizeFilesUi({ expandedPaths: ['/a', 1], recentPaths: 'x', editors: 3 })).toEqual({
      ...DEFAULT_FILES_UI,
      expandedPaths: ['/a']
    })
  })

  it('旧版的上次打开路径读成一个临时 Tab', () => {
    expect(normalizeFilesUi({ openPath: '/p/a.ts' }).editors).toEqual({
      panes: [{ id: 'p1', tabs: [{ path: '/p/a.ts', pinned: false }], active: '/p/a.ts' }],
      current: 'p1'
    })
  })

  it('布局不按上限截断（上限由面板定）', () => {
    const editors = {
      panes: [
        { id: 'p1', tabs: [{ path: '/a', pinned: true }], active: '/a' },
        { id: 'p2', tabs: [{ path: '/b', pinned: true }], active: '/b' }
      ],
      current: 'p2'
    }
    expect(normalizeFilesUi({ editors }).editors).toEqual(editors)
  })
})
