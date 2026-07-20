/**
 * 应用内快捷键匹配（main `before-input-event` 与单测共用）。
 * 仅在 DevCube 窗口聚焦时由主进程拦截；不使用 globalShortcut（避免抢其它 App）。
 */

export type AppShortcut =
  | { id: 'focusProjectFilter' }
  | { id: 'focusFilesFilter' }
  | { id: 'prevProject' }
  | { id: 'nextProject' }
  | { id: 'prevTab' }
  | { id: 'nextTab' }
  | { id: 'tabAt'; index: number }
  | { id: 'newTerminal' }
  | { id: 'closeTab' }
  | { id: 'cycleTabNext' }
  | { id: 'cycleTabPrev' }

/** 与 Electron `Input` / DOM KeyboardEvent 对齐的最小字段。 */
export interface ShortcutInput {
  type: string
  code: string
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

/** 若命中应用快捷键则返回动作，否则 null。 */
export function matchAppShortcut(input: ShortcutInput): AppShortcut | null {
  if (input.type !== 'keyDown') return null

  const mod = input.meta || input.control
  const { alt, shift, code, key } = input

  // Alt+CmdOrCtrl+P / F / ↑↓ / ←→
  if (mod && alt && !shift) {
    if (code === 'KeyP') return { id: 'focusProjectFilter' }
    if (code === 'KeyF') return { id: 'focusFilesFilter' }
    if (code === 'ArrowUp') return { id: 'prevProject' }
    if (code === 'ArrowDown') return { id: 'nextProject' }
    if (code === 'ArrowLeft') return { id: 'prevTab' }
    if (code === 'ArrowRight') return { id: 'nextTab' }
  }

  // CmdOrCtrl+1…9
  if (mod && !alt && !shift && /^Digit[1-9]$/.test(code)) {
    return { id: 'tabAt', index: Number(code.slice(5)) }
  }

  // CmdOrCtrl+T / W
  if (mod && !alt && !shift && (key === 't' || key === 'T' || code === 'KeyT')) {
    return { id: 'newTerminal' }
  }
  if (mod && !alt && !shift && (key === 'w' || key === 'W' || code === 'KeyW')) {
    return { id: 'closeTab' }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab（必须是 Control，不用 Cmd——macOS ⌘Tab 是系统切 App）
  if (input.control && !input.meta && !alt && (key === 'Tab' || code === 'Tab')) {
    return { id: shift ? 'cycleTabPrev' : 'cycleTabNext' }
  }

  return null
}
