/**
 * 快捷键 UI 文案（对齐 VS Code `UILabelProvider` / `_simpleAsString`）。
 * 修饰键固定顺序：Ctrl → Shift → Alt → Meta。
 * - macOS 纯文案：⌃ ⇧ ⌥ ⌘，符号间空格、无 `+`
 * - Windows：Ctrl + Shift + Alt + Windows，` + ` 连接
 * - Linux：Ctrl + Shift + Alt + Super，` + ` 连接
 * 富文本展示（设置列表）可把 token 映射为 Lucide，见 renderer `ShortcutLabel`。
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

export type ShortcutMod = 'ctrl' | 'shift' | 'alt' | 'meta'

/** 结构化片段：供纯文案拼接，或渲染层映射为 Lucide。 */
export type ShortcutToken =
  | { kind: 'mod'; mod: ShortcutMod }
  | { kind: 'key'; code: string; label: string }
  | { kind: 'sep' }

interface ModifierLabels {
  ctrlKey: string
  shiftKey: string
  altKey: string
  metaKey: string
  separator: string
}

const MAC_UI: ModifierLabels = {
  ctrlKey: '\u2303', // ⌃
  shiftKey: '\u21E7', // ⇧
  altKey: '\u2325', // ⌥
  metaKey: '\u2318', // ⌘
  separator: ' '
}

const WIN_UI: ModifierLabels = {
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  altKey: 'Alt',
  metaKey: 'Windows',
  separator: ' + '
}

const LINUX_UI: ModifierLabels = {
  ctrlKey: 'Ctrl',
  shiftKey: 'Shift',
  altKey: 'Alt',
  metaKey: 'Super',
  separator: ' + '
}

function labelsFor(platform: string): ModifierLabels {
  if (platform === 'darwin') return MAC_UI
  if (platform === 'linux') return LINUX_UI
  return WIN_UI
}

/** 方向键等：macOS 用符号，Win/Linux 用单词（对齐 VS Code UI 习惯）。 */
const NAMED_KEYS: Record<string, { mac: string; other: string }> = {
  ArrowUp: { mac: '\u2191', other: 'Up' },
  ArrowDown: { mac: '\u2193', other: 'Down' },
  ArrowLeft: { mac: '\u2190', other: 'Left' },
  ArrowRight: { mac: '\u2192', other: 'Right' },
  Tab: { mac: 'Tab', other: 'Tab' },
  Escape: { mac: 'Esc', other: 'Esc' },
  Enter: { mac: 'Enter', other: 'Enter' },
  Backspace: { mac: '\u232B', other: 'Backspace' },
  Delete: { mac: '\u2326', other: 'Delete' }
}

function formatKeyLabel(key: string, platform: string): string {
  const named = NAMED_KEYS[key]
  if (named) return platform === 'darwin' ? named.mac : named.other
  if (key.length === 1) return key.toUpperCase()
  if (!key) return key
  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
}

function resolvedModifiers(
  chord: ShortcutChord,
  platform: string
): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean } {
  let ctrl = !!chord.ctrl
  const shift = !!chord.shift
  const alt = !!chord.alt
  let meta = !!chord.meta
  if (chord.mod) {
    if (platform === 'darwin') meta = true
    else ctrl = true
  }
  return { ctrl, shift, alt, meta }
}

/** 拆成 token（顺序与 VS Code UILabel 一致）。 */
export function shortcutLabelTokens(chord: ShortcutChord, platform: string): ShortcutToken[] {
  const labels = labelsFor(platform)
  const { ctrl, shift, alt, meta } = resolvedModifiers(chord, platform)
  const tokens: ShortcutToken[] = []
  const pushMod = (mod: ShortcutMod): void => {
    if (tokens.length > 0 && labels.separator) tokens.push({ kind: 'sep' })
    tokens.push({ kind: 'mod', mod })
  }
  if (ctrl) pushMod('ctrl')
  if (shift) pushMod('shift')
  if (alt) pushMod('alt')
  if (meta) pushMod('meta')
  const keyLabel = formatKeyLabel(chord.key, platform)
  if (keyLabel) {
    if (tokens.length > 0 && labels.separator) tokens.push({ kind: 'sep' })
    tokens.push({ kind: 'key', code: chord.key, label: keyLabel })
  }
  return tokens
}

function modText(mod: ShortcutMod, platform: string): string {
  const labels = labelsFor(platform)
  if (mod === 'ctrl') return labels.ctrlKey
  if (mod === 'shift') return labels.shiftKey
  if (mod === 'alt') return labels.altKey
  return labels.metaKey
}

/** 按平台格式化单个快捷键组合，供 title / 菜单等纯文案展示。 */
export function formatShortcutLabel(chord: ShortcutChord, platform: string): string {
  return shortcutLabelTokens(chord, platform)
    .map((t) => {
      if (t.kind === 'sep') return labelsFor(platform).separator
      if (t.kind === 'mod') return modText(t.mod, platform)
      return t.label
    })
    .join('')
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
