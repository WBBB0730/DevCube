import { describe, expect, it } from 'vitest'
import { terminalClipboardAction } from './terminal-clipboard'

type KeyInput = Parameters<typeof terminalClipboardAction>[0]

const key = (
  k: string,
  mods: { shift?: boolean; alt?: boolean; meta?: boolean } = {}
): KeyInput => ({
  key: k,
  ctrlKey: true,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false
})

describe('terminalClipboardAction', () => {
  it('Windows：Ctrl+C 有选中才复制，没选中交给终端中断；Ctrl+Shift+C 总是复制', () => {
    expect(terminalClipboardAction(key('c'), 'win32', true)).toBe('copy')
    expect(terminalClipboardAction(key('c'), 'win32', false)).toBeNull()
    expect(terminalClipboardAction(key('C', { shift: true }), 'win32', false)).toBe('copy')
  })

  it('Windows：Ctrl+V 与 Ctrl+Shift+V 粘贴', () => {
    expect(terminalClipboardAction(key('v'), 'win32', false)).toBe('paste')
    expect(terminalClipboardAction(key('V', { shift: true }), 'win32', false)).toBe('paste')
  })

  it('Linux：只认 Ctrl+Shift+C / V，Ctrl+C / V 交给终端', () => {
    expect(terminalClipboardAction(key('C', { shift: true }), 'linux', false)).toBe('copy')
    expect(terminalClipboardAction(key('V', { shift: true }), 'linux', false)).toBe('paste')
    expect(terminalClipboardAction(key('c'), 'linux', true)).toBeNull()
    expect(terminalClipboardAction(key('v'), 'linux', false)).toBeNull()
  })

  it('macOS 与带 Alt / Meta 的组合不处理', () => {
    expect(terminalClipboardAction(key('c'), 'darwin', true)).toBeNull()
    expect(terminalClipboardAction(key('c', { alt: true }), 'win32', true)).toBeNull()
    expect(terminalClipboardAction(key('v', { meta: true }), 'win32', false)).toBeNull()
  })
})
