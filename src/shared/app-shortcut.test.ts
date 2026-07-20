import { describe, expect, it } from 'vitest'
import { matchAppShortcut, type ShortcutInput } from './app-shortcut'

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

describe('matchAppShortcut', () => {
  it('⌥⌘↑↓ 切项目；⌥⌘←→ 切 Tab', () => {
    expect(matchAppShortcut(key({ code: 'ArrowUp', meta: true, alt: true }))).toEqual({
      id: 'prevProject'
    })
    expect(matchAppShortcut(key({ code: 'ArrowDown', control: true, alt: true }))).toEqual({
      id: 'nextProject'
    })
    expect(matchAppShortcut(key({ code: 'ArrowLeft', meta: true, alt: true }))).toEqual({
      id: 'prevTab'
    })
    expect(matchAppShortcut(key({ code: 'ArrowRight', meta: true, alt: true }))).toEqual({
      id: 'nextTab'
    })
  })

  it('CmdOrCtrl+1…9 直达 Tab', () => {
    expect(matchAppShortcut(key({ code: 'Digit3', meta: true }))).toEqual({
      id: 'tabAt',
      index: 3
    })
  })

  it('Ctrl+Tab 循环；⌘Tab 不匹配', () => {
    expect(matchAppShortcut(key({ code: 'Tab', key: 'Tab', control: true }))).toEqual({
      id: 'cycleTabNext'
    })
    expect(matchAppShortcut(key({ code: 'Tab', key: 'Tab', control: true, shift: true }))).toEqual({
      id: 'cycleTabPrev'
    })
    expect(matchAppShortcut(key({ code: 'Tab', key: 'Tab', meta: true }))).toBeNull()
  })

  it('忽略 keyUp', () => {
    expect(
      matchAppShortcut(key({ type: 'keyUp', code: 'ArrowLeft', meta: true, alt: true }))
    ).toBeNull()
  })
})
