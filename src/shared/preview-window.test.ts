import { describe, expect, it } from 'vitest'
import {
  buildPreviewQuery,
  parentLogicalPath,
  parsePreviewLaunch,
  resolvePreviewRoot
} from './preview-window'

describe('parentLogicalPath', () => {
  it('逐级上翻，到文件系统根为止', () => {
    expect(parentLogicalPath('/Users/me/Pictures/a.png')).toBe('/Users/me/Pictures')
    expect(parentLogicalPath('/Users')).toBe('/')
    expect(parentLogicalPath('/')).toBeNull()
    expect(parentLogicalPath('C:/Users/me')).toBe('C:/Users')
    expect(parentLogicalPath('C:/Users')).toBe('C:/')
    expect(parentLogicalPath('C:/')).toBeNull()
  })
})

describe('resolvePreviewRoot', () => {
  it('落在已登记项目内取最深项目根，否则取所在文件夹', () => {
    const projects = ['/Users/me/web', '/Users/me/web/packages/ui']
    expect(resolvePreviewRoot('/Users/me/web/packages/ui/logo.png', projects)).toBe(
      '/Users/me/web/packages/ui'
    )
    expect(resolvePreviewRoot('/Users/me/web/docs/a.pdf', projects)).toBe('/Users/me/web')
    expect(resolvePreviewRoot('/Users/me/Downloads/a.png', projects)).toBe('/Users/me/Downloads')
  })
})

describe('preview launch query', () => {
  it('查询串往返', () => {
    const q = buildPreviewQuery({ file: '/a/b.png', root: '/a' })
    const search = '?' + new URLSearchParams(q).toString()
    expect(parsePreviewLaunch(search)).toEqual({ file: '/a/b.png', root: '/a' })
  })

  it('无文件（以项目根开窗）时 file 为 null 且查询串不带 file', () => {
    const q = buildPreviewQuery({ file: null, root: '/a' })
    expect('file' in q).toBe(false)
    expect(parsePreviewLaunch('?' + new URLSearchParams(q).toString())).toEqual({
      file: null,
      root: '/a'
    })
  })

  it('非预览模式 / 缺根为 null', () => {
    expect(parsePreviewLaunch('')).toBeNull()
    expect(parsePreviewLaunch('?mode=preview&file=%2Fa')).toBeNull()
  })
})
