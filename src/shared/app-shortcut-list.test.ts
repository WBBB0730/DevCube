import { describe, expect, it } from 'vitest'
import { formatSelectTabRangeShortcut } from './app-shortcut-list'

describe('formatSelectTabRangeShortcut', () => {
  it('macOS：⌘ 1…9', () => {
    expect(formatSelectTabRangeShortcut('darwin')).toBe('⌘ 1…9')
  })

  it('Windows：Ctrl + 1…9', () => {
    expect(formatSelectTabRangeShortcut('win32')).toBe('Ctrl + 1…9')
  })
})
