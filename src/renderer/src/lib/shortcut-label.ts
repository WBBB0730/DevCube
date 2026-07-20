import { formatShortcutLabel, type ShortcutChord } from '@shared/shortcut-label'

/** 当前运行平台上的快捷键展示文案（读 `window.electron.process.platform`）。 */
export function shortcutLabel(chord: ShortcutChord): string {
  return formatShortcutLabel(chord, window.electron.process.platform)
}

/** `说明 (⌘T)` / `说明 (Ctrl+T)` 形式的 title。 */
export function shortcutTitle(description: string, chord: ShortcutChord): string {
  return `${description} (${shortcutLabel(chord)})`
}
