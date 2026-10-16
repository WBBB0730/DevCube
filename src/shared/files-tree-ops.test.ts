import { describe, expect, it } from 'vitest'
import {
  allUnderRoot,
  copyDropAllowed,
  copyNameCandidate,
  moveDropAllowed,
  samePathSet,
  topLevelPaths
} from './files-tree-ops'

describe('topLevelPaths', () => {
  it('去掉文件夹里面的条目，保持原顺序', () => {
    expect(topLevelPaths(['/p/a/x.txt', '/p/a', '/p/b.txt', '/p/a/sub/y'])).toEqual([
      '/p/a',
      '/p/b.txt'
    ])
  })

  it('同名前缀不算包含', () => {
    expect(topLevelPaths(['/p/a', '/p/ab', '/p/a-b/c'])).toEqual(['/p/a', '/p/ab', '/p/a-b/c'])
  })

  it('去重', () => {
    expect(topLevelPaths(['/p/a', '/p/a'])).toEqual(['/p/a'])
  })

  it('Windows 盘符路径', () => {
    expect(topLevelPaths(['C:/p/a/x', 'C:/p/a'])).toEqual(['C:/p/a'])
  })
})

describe('moveDropAllowed / copyDropAllowed', () => {
  it('不能落到自身或它里面', () => {
    expect(moveDropAllowed('/p/a', '/p/a')).toBe(false)
    expect(moveDropAllowed('/p/a', '/p/a/sub')).toBe(false)
    expect(copyDropAllowed('/p/a', '/p/a')).toBe(false)
    expect(copyDropAllowed('/p/a', '/p/a/sub')).toBe(false)
  })

  it('移动落回原处不成立，复制可以', () => {
    expect(moveDropAllowed('/p/a/x.txt', '/p/a')).toBe(false)
    expect(copyDropAllowed('/p/a/x.txt', '/p/a')).toBe(true)
  })

  it('同名前缀的兄弟文件夹可以落', () => {
    expect(moveDropAllowed('/p/a', '/p/ab')).toBe(true)
    expect(moveDropAllowed('/p/a/x.txt', '/p')).toBe(true)
  })
})

describe('copyNameCandidate', () => {
  it('文件编号加在扩展名之前', () => {
    expect(copyNameCandidate('a.txt', false, 2)).toBe('a (2).txt')
    expect(copyNameCandidate('a.tar.gz', false, 3)).toBe('a.tar (3).gz')
  })

  it('文件夹、没有扩展名与点开头的名字编在整个名字之后', () => {
    expect(copyNameCandidate('src.v2', true, 2)).toBe('src.v2 (2)')
    expect(copyNameCandidate('Makefile', false, 2)).toBe('Makefile (2)')
    expect(copyNameCandidate('.env', false, 2)).toBe('.env (2)')
  })
})

describe('samePathSet', () => {
  it('不计顺序与重复', () => {
    expect(samePathSet(['/p/a', '/p/b'], ['/p/b', '/p/a', '/p/a'])).toBe(true)
  })

  it('多一个少一个都不算', () => {
    expect(samePathSet(['/p/a'], ['/p/a', '/p/b'])).toBe(false)
    expect(samePathSet([], ['/p/a'])).toBe(false)
  })
})

describe('allUnderRoot', () => {
  it('都在根内', () => {
    expect(allUnderRoot(['/p/a', '/p/b/c'], '/p')).toBe(true)
  })

  it('有一个在根外、或就是根自身都不算', () => {
    expect(allUnderRoot(['/p/a', '/q/b'], '/p')).toBe(false)
    expect(allUnderRoot(['/p'], '/p')).toBe(false)
    expect(allUnderRoot([], '/p')).toBe(false)
  })
})
