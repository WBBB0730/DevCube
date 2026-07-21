import { BrowserWindow, screen } from 'electron'
import {
  resolveWindowPlacement,
  type WindowPlacement,
  type WindowPlacementDefaults
} from '../shared/window-placement'

/** 仅进程内有效；重启后为空 → 回到默认几何。 */
let remembered: WindowPlacement | null = null

export function rememberWindowPlacement(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.getNormalBounds()
  remembered = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen()
  }
}

export function resolveRememberedWindowPlacement(
  defaults: WindowPlacementDefaults
): ReturnType<typeof resolveWindowPlacement> {
  const displays = screen.getAllDisplays().map((d) => d.bounds)
  return resolveWindowPlacement(remembered, defaults, displays)
}
