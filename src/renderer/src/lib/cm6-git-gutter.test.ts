import { describe, expect, it } from 'vitest'
import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { gitGutterLineKinds } from './cm6-git-gutter'

function kinds(baselineLines: string[], currentLines: string[]): Map<number, string> {
  const original = Text.of(baselineLines)
  const doc = Text.of(currentLines)
  return gitGutterLineKinds(doc, Chunk.build(original, doc))
}

describe('gitGutterLineKinds', () => {
  it('无差异 → 无标记', () => {
    expect(kinds(['a', 'b'], ['a', 'b']).size).toBe(0)
  })

  it('新增行 → added', () => {
    expect(kinds(['a', 'b'], ['a', 'x', 'b'])).toEqual(new Map([[2, 'added']]))
  })

  it('修改行 → modified', () => {
    expect(kinds(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual(new Map([[2, 'modified']]))
  })

  it('连续多行修改块整段标记', () => {
    const result = kinds(['a', 'b', 'c', 'd'], ['a', 'B', 'C', 'd'])
    expect(result).toEqual(
      new Map([
        [2, 'modified'],
        [3, 'modified']
      ])
    )
  })

  it('删除行 → 标记落在被删位置的下一行', () => {
    expect(kinds(['a', 'b', 'c'], ['a', 'c'])).toEqual(new Map([[2, 'deleted']]))
  })

  it('删除末行时前一行的换行也在变更内 → 末行按 modified 标记', () => {
    expect(kinds(['a', 'b'], ['a'])).toEqual(new Map([[1, 'modified']]))
  })

  it('新增与修改并存时互不串行', () => {
    const result = kinds(['a', 'b', 'e'], ['a', 'B', 'c', 'd', 'e'])
    expect(result.get(2)).toBe('modified')
    // b→B 与插入 c/d 相邻，合并为同一 chunk：整段按 modified 处理
    expect(result.get(3)).toBe('modified')
    expect(result.get(4)).toBe('modified')
    expect(result.has(5)).toBe(false)
  })

  it('新文件（基线为空串单行）整体视为改动', () => {
    const result = kinds([''], ['a', 'b'])
    expect(result.size).toBeGreaterThan(0)
  })
})
