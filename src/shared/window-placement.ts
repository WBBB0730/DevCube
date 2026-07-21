/** 主窗口几何：进程内记忆用（不落盘）。逻辑对齐常见 electron-window-state 行为。 */

export type WindowPlacement = {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
  isFullScreen: boolean
}

export type DisplayRect = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowPlacementDefaults = {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export type ResolvedWindowPlacement = {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
  isFullScreen: boolean
}

/** 窗口矩形是否完全落在某一块显示器 bounds 内。 */
export function isPlacementOnSomeDisplay(
  placement: Pick<WindowPlacement, 'x' | 'y' | 'width' | 'height'>,
  displays: ReadonlyArray<DisplayRect>
): boolean {
  return displays.some(
    (d) =>
      placement.x >= d.x &&
      placement.y >= d.y &&
      placement.x + placement.width <= d.x + d.width &&
      placement.y + placement.height <= d.y + d.height
  )
}

/**
 * 将进程内记忆解析为 BrowserWindow 构造参数。
 * 无记忆 / 不在任何显示器上 → 默认宽高且不指定坐标（由 Electron 居中）。
 */
export function resolveWindowPlacement(
  saved: WindowPlacement | null,
  defaults: WindowPlacementDefaults,
  displays: ReadonlyArray<DisplayRect>
): ResolvedWindowPlacement {
  if (saved === null || !isPlacementOnSomeDisplay(saved, displays)) {
    return {
      width: defaults.width,
      height: defaults.height,
      isMaximized: false,
      isFullScreen: false
    }
  }

  return {
    x: saved.x,
    y: saved.y,
    width: Math.max(saved.width, defaults.minWidth),
    height: Math.max(saved.height, defaults.minHeight),
    isMaximized: saved.isMaximized,
    isFullScreen: saved.isFullScreen
  }
}
