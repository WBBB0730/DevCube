import { describe, expect, it } from 'vitest'
import { SHORTCUT, formatShortcutLabel, tabAtShortcut } from './shortcut-label'

describe('formatShortcutLabel', () => {
  it('macOS：符号、无分隔符；顺序 Ctrl→Shift→Alt→Meta', () => {
    expect(formatShortcutLabel({ mod: true, key: 't' }, 'darwin')).toBe('⌘T')
    expect(formatShortcutLabel({ mod: true, alt: true, key: 'P' }, 'darwin')).toBe('⌥⌘P')
    expect(formatShortcutLabel({ ctrl: true, shift: true, alt: true, key: 'P' }, 'darwin')).toBe(
      '⌃⇧⌥P'
    )
  })

  it('Windows：Ctrl/Alt 文案 + 号连接', () => {
    expect(formatShortcutLabel({ mod: true, key: 'T' }, 'win32')).toBe('Ctrl+T')
    expect(formatShortcutLabel({ mod: true, alt: true, key: 'P' }, 'win32')).toBe('Ctrl+Alt+P')
    expect(formatShortcutLabel({ mod: true, alt: true, key: 'F' }, 'win32')).toBe('Ctrl+Alt+F')
  })

  it('Linux：与 Windows 同形，Meta 为 Super', () => {
    expect(formatShortcutLabel({ mod: true, key: 'W' }, 'linux')).toBe('Ctrl+W')
    expect(formatShortcutLabel({ meta: true, key: 'A' }, 'linux')).toBe('Super+A')
  })

  it('强制 ctrl 在 macOS 也不升成 ⌘（Ctrl+Tab）', () => {
    expect(formatShortcutLabel({ ctrl: true, key: 'Tab' }, 'darwin')).toBe('⌃Tab')
    expect(formatShortcutLabel({ ctrl: true, key: 'Tab' }, 'win32')).toBe('Ctrl+Tab')
  })

  it('SHORTCUT 常量与筛选键一致', () => {
    expect(formatShortcutLabel(SHORTCUT.projectFilter, 'darwin')).toBe('⌥⌘P')
    expect(formatShortcutLabel(SHORTCUT.filesFilter, 'win32')).toBe('Ctrl+Alt+F')
  })

  it('Tab 直达 1–9', () => {
    expect(formatShortcutLabel(tabAtShortcut(1), 'darwin')).toBe('⌘1')
    expect(formatShortcutLabel(tabAtShortcut(9), 'win32')).toBe('Ctrl+9')
  })

  it('切项目 / 切 Tab：方向键按平台符号化 / 单词化', () => {
    expect(formatShortcutLabel(SHORTCUT.prevProject, 'darwin')).toBe('⌥⌘↑')
    expect(formatShortcutLabel(SHORTCUT.nextProject, 'win32')).toBe('Ctrl+Alt+Down')
    expect(formatShortcutLabel(SHORTCUT.prevTab, 'darwin')).toBe('⌥⌘←')
    expect(formatShortcutLabel(SHORTCUT.nextTab, 'win32')).toBe('Ctrl+Alt+Right')
  })
})
