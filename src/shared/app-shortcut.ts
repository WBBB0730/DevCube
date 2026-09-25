/**
 * 应用内快捷键匹配（main `before-input-event` 与单测共用）。
 * 仅在 DevCube 窗口聚焦时由主进程拦截；不使用 globalShortcut（避免抢其它 App）。
 */

export type AppShortcut =
  | { id: 'focusProjectFilter' }
  | { id: 'focusFilesFilter' }
  | { id: 'contentSearch' }
  | { id: 'recentFiles' }
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

/** 匹配时的环境。 */
export interface ShortcutContext {
  /** `process.platform`：决定主修饰键是 ⌘ 还是 Ctrl */
  platform: string
  /** 焦点在终端（xterm）里：由渲染端上报，据此把与 shell 冲突的键让出去 */
  terminalFocused: boolean
}

/**
 * 是否恰好按下本平台的主修饰键（CmdOrCtrl）：macOS 只认 ⌘、Windows / Linux 只认 Ctrl，
 * 另一个不得混入——否则 macOS 的 ⌃T / ⌃W 这类 shell 编辑键会被当成 ⌘ 抢走。
 */
export function isPrimaryModifier(
  input: Pick<ShortcutInput, 'meta' | 'control'>,
  platform: string
): boolean {
  return platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
}

/** 若命中应用快捷键则返回动作，否则 null。 */
export function matchAppShortcut(input: ShortcutInput, ctx: ShortcutContext): AppShortcut | null {
  if (input.type !== 'keyDown') return null

  const mod = isPrimaryModifier(input, ctx.platform)
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

  // CmdOrCtrl+Shift+F：内容搜索面板
  if (mod && shift && !alt && code === 'KeyF') {
    return { id: 'contentSearch' }
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

  // CmdOrCtrl+E：最近打开文件。Ctrl+E 是 shell 的「跳到行尾」，焦点在终端时让给 shell（macOS 用 ⌘ 不冲突）
  if (mod && !alt && !shift && (key === 'e' || key === 'E' || code === 'KeyE')) {
    return ctx.terminalFocused && input.control ? null : { id: 'recentFiles' }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab（必须是 Control，不用 Cmd——macOS ⌘Tab 是系统切 App）
  if (input.control && !input.meta && !alt && (key === 'Tab' || code === 'Tab')) {
    return { id: shift ? 'cycleTabPrev' : 'cycleTabNext' }
  }

  return null
}
