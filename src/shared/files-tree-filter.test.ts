import { describe, expect, it } from 'vitest'
import { isIdeIgnoredEntryName } from './files-tree-filter'

describe('isIdeIgnoredEntryName', () => {
  it('隐藏 WebStorm 默认忽略的目录/文件名', () => {
    expect(isIdeIgnoredEntryName('.git')).toBe(true)
    expect(isIdeIgnoredEntryName('.DS_Store')).toBe(true)
    expect(isIdeIgnoredEntryName('.ds_store')).toBe(true)
    expect(isIdeIgnoredEntryName('.svn')).toBe(true)
    expect(isIdeIgnoredEntryName('.hg')).toBe(true)
    expect(isIdeIgnoredEntryName('CVS')).toBe(true)
    expect(isIdeIgnoredEntryName('__pycache__')).toBe(true)
    expect(isIdeIgnoredEntryName('_svn')).toBe(true)
    expect(isIdeIgnoredEntryName('vssver.scc')).toBe(true)
    expect(isIdeIgnoredEntryName('vssver2.scc')).toBe(true)
  })

  it('隐藏默认扩展名与 *~ 备份', () => {
    expect(isIdeIgnoredEntryName('heap.hprof')).toBe(true)
    expect(isIdeIgnoredEntryName('a.pyc')).toBe(true)
    expect(isIdeIgnoredEntryName('a.pyo')).toBe(true)
    expect(isIdeIgnoredEntryName('a.rbc')).toBe(true)
    expect(isIdeIgnoredEntryName('a.yarb')).toBe(true)
    expect(isIdeIgnoredEntryName('file~')).toBe(true)
  })

  it('不按 gitignore 藏 node_modules / .env / 源码', () => {
    expect(isIdeIgnoredEntryName('node_modules')).toBe(false)
    expect(isIdeIgnoredEntryName('.env')).toBe(false)
    expect(isIdeIgnoredEntryName('.gitignore')).toBe(false)
    expect(isIdeIgnoredEntryName('src')).toBe(false)
    expect(isIdeIgnoredEntryName('app.ts')).toBe(false)
    expect(isIdeIgnoredEntryName('.idea')).toBe(false)
  })
})
