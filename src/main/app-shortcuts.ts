// 窗口聚焦时在主进程拦截应用快捷键（先于渲染层 / Chromium 默认行为），再 IPC 交给渲染端执行。
import type { BrowserWindow } from 'electron'
import { matchAppShortcut } from '../shared/app-shortcut'
import { IPC } from '../shared/ipc'

export function wireAppShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    const hit = matchAppShortcut({
      type: input.type,
      code: input.code,
      key: input.key,
      meta: input.meta,
      control: input.control,
      alt: input.alt,
      shift: input.shift
    })
    if (!hit) return
    event.preventDefault()
    win.webContents.send(IPC.appShortcut, hit)
  })
}
