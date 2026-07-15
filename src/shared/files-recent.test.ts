import { describe, expect, it } from 'vitest'
import { FILES_RECENT_MAX, pushRecentPath } from './files'

describe('pushRecentPath', () => {
  it('新路径插到头部', () => {
    expect(pushRecentPath(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('重复路径移到头部', () => {
    expect(pushRecentPath(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('超过上限截断', () => {
    const many = Array.from({ length: FILES_RECENT_MAX }, (_, i) => `f${i}`)
    const next = pushRecentPath(many, 'new')
    expect(next).toHaveLength(FILES_RECENT_MAX)
    expect(next[0]).toBe('new')
    expect(next).not.toContain(`f${FILES_RECENT_MAX - 1}`)
  })
})
