import { BrowserWindow, screen } from 'electron'
import {
  resolveWindowPlacement,
  type WindowPlacement,
  type WindowPlacementDefaults
} from '../shared/window-placement'

/** 主窗口与预览窗口各记一份；仅进程内有效，重启后为空 → 回到默认几何。 */
export type WindowPlacementKey = 'main' | 'preview'

const remembered = new Map<WindowPlacementKey, WindowPlacement>()

export function rememberWindowPlacement(win: BrowserWindow, key: WindowPlacementKey): void {
  if (win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  remembered.set(key, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  })
}

export function resolveRememberedWindowPlacement(
  defaults: WindowPlacementDefaults,
  key: WindowPlacementKey
): ReturnType<typeof resolveWindowPlacement> {
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  return resolveWindowPlacement(remembered.get(key) ?? null, defaults, displays)
}
