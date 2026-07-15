import { describe, expect, it } from 'vitest'
import { normalizePath, resolveWithinProject } from './files-path'

describe('normalizePath', () => {
  it('折叠 . 与 ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  })
})

describe('resolveWithinProject', () => {
  const root = '/proj'

  it('接受项目根自身', () => {
    expect(resolveWithinProject(root, root)).toBe('/proj')
    expect(resolveWithinProject(root, '.')).toBe('/proj')
  })

  it('接受根下相对路径', () => {
    expect(resolveWithinProject(root, 'src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('拒绝 .. 穿越', () => {
    expect(resolveWithinProject(root, '../outside')).toBeNull()
    expect(resolveWithinProject(root, 'a/../../outside')).toBeNull()
  })

  it('拒绝根外绝对路径', () => {
    expect(resolveWithinProject(root, '/other/file')).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(resolveWithinProject('', 'a')).toBeNull()
    expect(resolveWithinProject(root, '')).toBeNull()
  })
})
