import { isPrimaryModifier } from '@shared/app-shortcut'
import { formatShortcutLabel, type ShortcutChord } from '@shared/shortcut-label'

/** 当前运行平台上的快捷键展示文案（读 `window.electron.process.platform`）。 */
export function shortcutLabel(chord: ShortcutChord): string {
  return formatShortcutLabel(chord, window.electron.process.platform)
}

/** `说明 (⌘T)` / `说明 (Ctrl+T)` 形式的 title。 */
export function shortcutTitle(description: string, chord: ShortcutChord): string {
  return `${description} (${shortcutLabel(chord)})`
}

/** 渲染层键盘处理用：是否恰好按下当前平台的主修饰键（macOS ⌘ / 其他 Ctrl，见 `isPrimaryModifier`）。 */
export function isPrimaryModifierEvent(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return isPrimaryModifier(
    { meta: e.metaKey, control: e.ctrlKey },
    window.electron.process.platform
  )
}
