import { describe, expect, it } from 'vitest'
import { parseBytesRange } from './files-media-range'

describe('parseBytesRange', () => {
  it('无 Range → 整文件', () => {
    expect(parseBytesRange(null, 1000)).toBe('all')
    expect(parseBytesRange('', 1000)).toBe('all')
  })

  it('bytes=start-（Chromium 常见）', () => {
    expect(parseBytesRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseBytesRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 })
  })

  it('bytes=start-end', () => {
    expect(parseBytesRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseBytesRange('bytes=10-19', 1000)).toEqual({ start: 10, end: 19 })
  })

  it('bytes=-suffix', () => {
    expect(parseBytesRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('end 超出文件大小时钳制', () => {
    expect(parseBytesRange('bytes=0-9999', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('越界 / 多段 → null', () => {
    expect(parseBytesRange('bytes=1000-', 1000)).toBeNull()
    expect(parseBytesRange('bytes=0-10,20-30', 1000)).toBeNull()
    expect(parseBytesRange('items=0-10', 1000)).toBeNull()
  })
})
