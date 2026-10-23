import { describe, expect, it } from 'vitest'
import { findSeed } from './find-seed'

describe('findSeed', () => {
  it('选中的单行文字原样预填', () => {
    expect(findSeed('useFindSession', false)).toBe('useFindSession')
    expect(findSeed(' a.b ', false)).toBe(' a.b ')
  })

  it('没选中或跨行不预填，沿用原查询', () => {
    expect(findSeed('', false)).toBeNull()
    expect(findSeed('第一行\n第二行', false)).toBeNull()
    expect(findSeed('第一行\r\n', true)).toBeNull()
  })

  it('开着正则时转义成字面量', () => {
    expect(findSeed('a.b(c)*', true)).toBe('a\\.b\\(c\\)\\*')
    expect(new RegExp(findSeed('[x]+?', true)!).test('[x]+?')).toBe(true)
  })
})
