import { describe, expect, it } from 'vitest'
import {
  isPrimaryModifier,
  matchAppShortcut,
  type ShortcutContext,
  type ShortcutInput
} from './app-shortcut'

function key(partial: Partial<ShortcutInput> & Pick<ShortcutInput, 'code'>): ShortcutInput {
  return {
    type: 'keyDown',
    key: partial.key ?? '',
    meta: false,
    control: false,
    alt: false,
    shift: false,
    ...partial
  }
}

const MAC: ShortcutContext = { platform: 'darwin', terminalFocused: false }
const WIN: ShortcutContext = { platform: 'win32', terminalFocused: false }
const MAC_TERM: ShortcutContext = { ...MAC, terminalFocused: true }
const WIN_TERM: ShortcutContext = { ...WIN, terminalFocused: true }

describe('isPrimaryModifier', () => {
  it('macOS 只认 ⌘，⌃ 不冒充', () => {
    expect(isPrimaryModifier({ meta: true, control: false }, 'darwin')).toBe(true)
    expect(isPrimaryModifier({ meta: false, control: true }, 'darwin')).toBe(false)
    expect(isPrimaryModifier({ meta: true, control: true }, 'darwin')).toBe(false)
  })

  it('Windows / Linux 只认 Ctrl，Win / Super 不冒充', () => {
    expect(isPrimaryModifier({ meta: false, control: true }, 'win32')).toBe(true)
    expect(isPrimaryModifier({ meta: false, control: true }, 'linux')).toBe(true)
    expect(isPrimaryModifier({ meta: true, control: false }, 'linux')).toBe(false)
    expect(isPrimaryModifier({ meta: true, control: true }, 'win32')).toBe(false)
  })
})

describe('matchAppShortcut', () => {
  it('⌥⌘↑↓ 切项目；⌥⌘←→ 切 Tab', () => {
    expect(matchAppShortcut(key({ code: 'ArrowUp', meta: true, alt: true }), MAC)).toEqual({
      id: 'prevProject'
    })
    expect(matchAppShortcut(key({ code: 'ArrowDown', control: true, alt: true }), WIN)).toEqual({
      id: 'nextProject'
    })
    expect(matchAppShortcut(key({ code: 'ArrowLeft', meta: true, alt: true }), MAC)).toEqual({
      id: 'prevTab'
    })
    expect(matchAppShortcut(key({ code: 'ArrowRight', meta: true, alt: true }), MAC)).toEqual({
      id: 'nextTab'
    })
  })

  it('CmdOrCtrl+1…9 直达 Tab', () => {
    expect(matchAppShortcut(key({ code: 'Digit3', meta: true }), MAC)).toEqual({
      id: 'tabAt',
      index: 3
    })
  })

  it('主修饰键按平台严格匹配：macOS 的 ⌃T / ⌃W / ⌃1 留给 shell，Win 键组合不触发', () => {
    expect(matchAppShortcut(key({ code: 'KeyT', key: 't', control: true }), MAC)).toBeNull()
    expect(matchAppShortcut(key({ code: 'KeyW', key: 'w', control: true }), MAC)).toBeNull()
    expect(matchAppShortcut(key({ code: 'Digit1', control: true }), MAC)).toBeNull()
    expect(matchAppShortcut(key({ code: 'KeyT', key: 't', meta: true }), WIN)).toBeNull()
    expect(matchAppShortcut(key({ code: 'KeyT', key: 't', control: true }), WIN)).toEqual({
      id: 'newTerminal'
    })
  })

  it('Ctrl+Tab 循环；⌘Tab 不匹配', () => {
    expect(matchAppShortcut(key({ code: 'Tab', key: 'Tab', control: true }), MAC)).toEqual({
      id: 'cycleTabNext'
    })
    expect(
      matchAppShortcut(key({ code: 'Tab', key: 'Tab', control: true, shift: true }), WIN)
    ).toEqual({
      id: 'cycleTabPrev'
    })
    expect(matchAppShortcut(key({ code: 'Tab', key: 'Tab', meta: true }), MAC)).toBeNull()
  })

  it('⌘⇧F 内容搜索；⌥⌘F 仍是文件筛选', () => {
    expect(matchAppShortcut(key({ code: 'KeyF', meta: true, shift: true }), MAC)).toEqual({
      id: 'contentSearch'
    })
    expect(matchAppShortcut(key({ code: 'KeyF', control: true, shift: true }), WIN)).toEqual({
      id: 'contentSearch'
    })
    expect(matchAppShortcut(key({ code: 'KeyF', meta: true, alt: true }), MAC)).toEqual({
      id: 'focusFilesFilter'
    })
    expect(matchAppShortcut(key({ code: 'KeyF', meta: true }), MAC)).toBeNull()
  })

  it('⌘E / Ctrl+E 最近打开文件', () => {
    expect(matchAppShortcut(key({ code: 'KeyE', key: 'e', meta: true }), MAC)).toEqual({
      id: 'recentFiles'
    })
    expect(matchAppShortcut(key({ code: 'KeyE', key: 'e', control: true }), WIN)).toEqual({
      id: 'recentFiles'
    })
    expect(matchAppShortcut(key({ code: 'KeyE', key: 'e', control: true }), MAC)).toBeNull()
  })

  it('焦点在终端：Win / Linux 的 Ctrl+E 让给 shell，macOS 的 ⌘E 照常；Ctrl+W / Ctrl+T 仍归应用', () => {
    expect(matchAppShortcut(key({ code: 'KeyE', key: 'e', control: true }), WIN_TERM)).toBeNull()
    expect(matchAppShortcut(key({ code: 'KeyE', key: 'e', meta: true }), MAC_TERM)).toEqual({
      id: 'recentFiles'
    })
    expect(matchAppShortcut(key({ code: 'KeyW', key: 'w', control: true }), WIN_TERM)).toEqual({
      id: 'closeTab'
    })
    expect(matchAppShortcut(key({ code: 'KeyT', key: 't', control: true }), WIN_TERM)).toEqual({
      id: 'newTerminal'
    })
  })

  it('忽略 keyUp', () => {
    expect(
      matchAppShortcut(key({ type: 'keyUp', code: 'ArrowLeft', meta: true, alt: true }), MAC)
    ).toBeNull()
  })
})
