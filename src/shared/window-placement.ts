/**
 * 窗口几何的记忆（主进程内存一份，「记住窗口和面板布局」开着时落盘，ADR-0053）。
 * 逻辑对齐常见 electron-window-state 行为。
 */

/** 主窗口与预览窗口各记一份。 */
export const WINDOW_PLACEMENT_KEYS = ['main', 'preview'] as const

export type WindowPlacementKey = (typeof WINDOW_PLACEMENT_KEYS)[number]

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

function isWindowPlacement(value: unknown): value is WindowPlacement {
  if (value === null || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
  return (
    finite(p.x) &&
    finite(p.y) &&
    finite(p.width) &&
    finite(p.height) &&
    typeof p.isMaximized === 'boolean' &&
    typeof p.isFullScreen === 'boolean'
  )
}

/** 落盘的几何只留已知窗口里形状合法的记录（老档案或脏值不进来）。 */
export function normalizeWindowPlacements(
  raw: unknown
): Partial<Record<WindowPlacementKey, WindowPlacement>> {
  const out: Partial<Record<WindowPlacementKey, WindowPlacement>> = {}
  if (raw === null || typeof raw !== 'object') return out
  const record = raw as Record<string, unknown>
  for (const key of WINDOW_PLACEMENT_KEYS) {
    const p = record[key]
    if (isWindowPlacement(p)) {
      const { x, y, width, height, isMaximized, isFullScreen } = p
      out[key] = { x, y, width, height, isMaximized, isFullScreen }
    }
  }
  return out
}

/**
 * 按尺寸摆在区域正中（恢复默认布局用）。offset：向右下错开，多个同类窗口依次排开；尺寸或错开后超出区域时收进区域。
 */
export function centerInArea(
  size: Pick<DisplayRect, 'width' | 'height'>,
  area: DisplayRect,
  offset = 0
): DisplayRect {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  return {
    x: Math.min(
      area.x + Math.round((area.width - width) / 2) + offset,
      area.x + area.width - width
    ),
    y: Math.min(
      area.y + Math.round((area.height - height) / 2) + offset,
      area.y + area.height - height
    ),
    width,
    height
  }
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
 * 将记忆解析为 BrowserWindow 构造参数。
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
