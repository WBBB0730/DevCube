import { describe, expect, it } from 'vitest'
import { compileTextFind, locateTextOffset, type TextFindOptions } from './text-find'

const PLAIN: TextFindOptions = { caseSensitive: false, wholeWord: false }

/** 在 `text` 里找 `query` 的全部命中；正则写错为 null */
function find(query: string, text: string, options: TextFindOptions = PLAIN): number[][] | null {
  return compileTextFind(query, options)?.(text) ?? null
}

describe('compileTextFind', () => {
  it('默认不分大小写，返回自左向右、互不重叠的全部命中', () => {
    expect(find('ab', 'AB ab aB')).toEqual([
      [0, 2],
      [3, 5],
      [6, 8]
    ])
    expect(find('aa', 'aaaa')).toEqual([
      [0, 2],
      [2, 4]
    ])
  })

  it('区分大小写', () => {
    expect(find('Total', 'total Total', { ...PLAIN, caseSensitive: true })).toEqual([[6, 11]])
  })

  it('不开正则时查询里的正则符号按原字找', () => {
    expect(find('a.b', 'axb a.b')).toEqual([[4, 7]])
    expect(find('(1)', '1 (1)')).toEqual([[2, 5]])
  })

  it('全词：两侧不能紧挨词字符（字母 / 数字 / 下划线，含中文）', () => {
    const whole = { ...PLAIN, wholeWord: true }
    expect(find('total', 'subtotal total total_1', whole)).toEqual([[9, 14]])
    expect(find('合计', '合计：x 小合计', whole)).toEqual([[0, 2]])
  })

  it('全词：查询自身两端不是词字符时那一端不要求', () => {
    expect(find('-5', 'x-5 元', { ...PLAIN, wholeWord: true })).toEqual([[1, 3]])
  })

  it('全词：不在词界上的候选不挡住与它重叠的下一个候选', () => {
    expect(find('a a', 'xa a a', { ...PLAIN, wholeWord: true })).toEqual([[3, 6]])
  })

  it('正则：^ / $ 认行首行尾，可与全词同用', () => {
    const regexp = { ...PLAIN, regexp: true }
    expect(find('a\\d+', 'a1 b a23', regexp)).toEqual([
      [0, 2],
      [5, 8]
    ])
    expect(find('^x', 'x\nx y x', regexp)).toEqual([
      [0, 1],
      [2, 3]
    ])
    expect(find('a\\w', 'ab abc', { ...regexp, wholeWord: true })).toEqual([[0, 2]])
  })

  it('正则：空命中跳过', () => {
    expect(find('b*', 'abba', { ...PLAIN, regexp: true })).toEqual([[1, 3]])
  })

  it('emoji、生僻字等两个码元的字：空命中与不在词界上的候选按整字跳过', () => {
    expect(find('b*', '😀b', { ...PLAIN, regexp: true })).toEqual([[2, 3]])
    expect(find('𠀀', 'x𠀀 𠀀', { ...PLAIN, wholeWord: true })).toEqual([[4, 6]])
  })

  it('正则写错为 null', () => {
    expect(find('(', 'a(b', { ...PLAIN, regexp: true })).toBeNull()
  })

  it('空查询恒无命中', () => {
    expect(find('', 'abc')).toEqual([])
  })
})

describe('locateTextOffset', () => {
  it('起点在节点边界取后一个节点，终点在边界取前一个节点', () => {
    expect(locateTextOffset(['ab', 'cd'], 2, false)).toEqual([1, 0])
    expect(locateTextOffset(['ab', 'cd'], 2, true)).toEqual([0, 2])
  })

  it('越界为 null', () => {
    expect(locateTextOffset(['ab'], 2, false)).toBeNull()
    expect(locateTextOffset(['ab'], 3, true)).toBeNull()
  })
})
