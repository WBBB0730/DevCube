/**
 * 快捷键 UI 文案（对齐 VS Code `UILabelProvider` / `_simpleAsString`）。
 * 修饰键固定顺序：Ctrl → Shift → Alt → Meta。
 * - macOS：⌃⇧⌥⌘，无分隔符
 * - Windows：Ctrl+Shift+Alt+Windows，`+` 连接
 * - Linux：Ctrl+Shift+Alt+Super，`+` 连接
 */

export interface ShortcutChord {
  /** Cmd（macOS）/ Ctrl（Windows·Linux）——跨平台主修饰键 */
  mod?: boolean
  /** 强制 Control（如 Ctrl+Tab，macOS 也不升成 ⌘） */
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** 强制 Meta / ⌘ / Windows / Super */
  meta?: boolean
  /** 主键展示名，如 `P`、`Tab`、`F` */
  key: string
}

interface ModifierLabels {
  ctrlKey: string
  shiftKey: string
  altKey: string
  metaKey: string
  separator: string
}

const MAC_UI: ModifierLabels = {
  ctrlKey: '\u2303', // ⌃
  shiftKey: '⇧',
  altKey: '⌥',
  metaKey: '⌘',
  separator: ''
}

const WIN_UI: ModifierLabels = {
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  altKey: 'Alt',
  metaKey: 'Windows',
  separator: '+'
}

const LINUX_UI: ModifierLabels = {
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  altKey: 'Alt',
  metaKey: 'Super',
  separator: '+'
}

function labelsFor(platform: string): ModifierLabels {
  if (platform === 'darwin') return MAC_UI
  if (platform === 'linux') return LINUX_UI
  return WIN_UI
}

/** 方向键等：macOS 用符号，Win/Linux 用单词（对齐 VS Code UI 习惯）。 */
const NAMED_KEYS: Record<string, { mac: string; other: string }> = {
  ArrowUp: { mac: '↑', other: 'Up' },
  ArrowDown: { mac: '↓', other: 'Down' },
  ArrowLeft: { mac: '←', other: 'Left' },
  ArrowRight: { mac: '→', other: 'Right' },
  Tab: { mac: 'Tab', other: 'Tab' },
  Escape: { mac: 'Esc', other: 'Esc' },
  Enter: { mac: 'Enter', other: 'Enter' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Delete: { mac: '⌦', other: 'Delete' }
}

function formatKeyLabel(key: string, platform: string): string {
  const named = NAMED_KEYS[key]
  if (named) return platform === 'darwin' ? named.mac : named.other
  if (key.length === 1) return key.toUpperCase()
  if (!key) return key
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
}

/** 按平台格式化单个快捷键组合，供 title / 菜单等展示。 */
export function formatShortcutLabel(chord: ShortcutChord, platform: string): string {
  const labels = labelsFor(platform)
  let ctrlKey = !!chord.ctrl
  let shiftKey = !!chord.shift
  let altKey = !!chord.alt
  let metaKey = !!chord.meta
  if (chord.mod) {
    if (platform === 'darwin') metaKey = true
    else ctrlKey = true
  }

  const parts: string[] = []
  if (ctrlKey) parts.push(labels.ctrlKey)
  if (shiftKey) parts.push(labels.shiftKey)
  if (altKey) parts.push(labels.altKey)
  if (metaKey) parts.push(labels.metaKey)
  const keyLabel = formatKeyLabel(chord.key, platform)
  if (keyLabel) parts.push(keyLabel)
  return parts.join(labels.separator)
}

/** 常用快捷键 chord，供 UI title 复用。 */
export const SHORTCUT = {
  projectFilter: { mod: true, alt: true, key: 'P' } satisfies ShortcutChord,
  filesFilter: { mod: true, alt: true, key: 'F' } satisfies ShortcutChord,
  prevProject: { mod: true, alt: true, key: 'ArrowUp' } satisfies ShortcutChord,
  nextProject: { mod: true, alt: true, key: 'ArrowDown' } satisfies ShortcutChord,
  prevTab: { mod: true, alt: true, key: 'ArrowLeft' } satisfies ShortcutChord,
  nextTab: { mod: true, alt: true, key: 'ArrowRight' } satisfies ShortcutChord,
  newTerminal: { mod: true, key: 'T' } satisfies ShortcutChord,
  closeTab: { mod: true, key: 'W' } satisfies ShortcutChord,
  find: { mod: true, key: 'F' } satisfies ShortcutChord,
  refresh: { mod: true, key: 'R' } satisfies ShortcutChord,
  cycleTabNext: { ctrl: true, key: 'Tab' } satisfies ShortcutChord,
  cycleTabPrev: { ctrl: true, shift: true, key: 'Tab' } satisfies ShortcutChord
} as const

/** 直达当前项目第 `n` 个 Tab（1–9）。 */
export function tabAtShortcut(n: number): ShortcutChord {
  return { mod: true, key: String(n) }
}
