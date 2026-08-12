import { describe, expect, it } from 'vitest'
import { normalizePath, remapPathPrefix, resolveWithinProject } from './files-path'

describe('normalizePath', () => {
  it('折叠 . 与 ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  })
})

describe('remapPathPrefix', () => {
  it('命中自身与后代时替换前缀', () => {
    expect(remapPathPrefix('/p/a', '/p/a', '/p/b')).toBe('/p/b')
    expect(remapPathPrefix('/p/a/x/y', '/p/a', '/p/b')).toBe('/p/b/x/y')
  })

  it('同名前缀但非路径边界不误伤', () => {
    expect(remapPathPrefix('/p/ab/x', '/p/a', '/p/b')).toBe('/p/ab/x')
  })

  it('无关路径原样返回', () => {
    expect(remapPathPrefix('/q/c', '/p/a', '/p/b')).toBe('/q/c')
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
