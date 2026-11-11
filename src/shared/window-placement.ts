/**
 * 窗口几何的记忆（主进程内存一份，「记住窗口和面板布局」开着时落盘，ADR-0053）：
 * 按窗口读数更新记录的规则，与恢复时把记录解析为建窗几何的规则。
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

/** 一块显示器：整块范围与工作区（去掉菜单栏、Dock、任务栏） */
export type DisplayArea = {
  bounds: DisplayRect
  workArea: DisplayRect
}

export type ScreenLayout = {
  displays: ReadonlyArray<DisplayArea>
  /** 主显示器的工作区：没有可用记忆时，默认大小摆在这里正中 */
  primaryWorkArea: DisplayRect
}

/** 窗口此刻的读数：实际矩形与状态（全屏从开始进入到退出完成都算，见窗口壳 windowState） */
export type WindowReading = DisplayRect & {
  isMinimized: boolean
  isMaximized: boolean
  isFullScreen: boolean
}

export type WindowPlacementDefaults = {
  width: number
  height: number
  minWidth: number
  minHeight: number
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

export function windowPlacementsEqual(a: WindowPlacement, b: WindowPlacement): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.isMaximized === b.isMaximized &&
    a.isFullScreen === b.isFullScreen
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
 * 按读数更新窗口的几何记录。位置尺寸只取普通状态下的实际矩形：最大化 / 全屏时窗口的矩形不是它的正常尺寸，
 * 保持原样；全屏期间底下是否最大化看不到，保持进全屏前的；最小化时整份不动（恢复时不还原最小化）。
 */
export function nextWindowPlacement(
  prev: WindowPlacement,
  reading: WindowReading
): WindowPlacement {
  if (reading.isMinimized) return prev
  if (reading.isFullScreen) return { ...prev, isFullScreen: true }
  if (reading.isMaximized) return { ...prev, isMaximized: true, isFullScreen: false }
  const { x, y, width, height } = reading
  return { x, y, width, height, isMaximized: false, isFullScreen: false }
}

/** 收进区域：比区域大就缩到区域大小，再把越出的部分推回区域内。 */
export function fitInArea(rect: DisplayRect, area: DisplayRect): DisplayRect {
  const width = Math.min(rect.width, area.width)
  const height = Math.min(rect.height, area.height)
  return {
    x: Math.min(Math.max(rect.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(rect.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

/**
 * 按尺寸摆在区域正中（默认布局用）。offset：向右下错开，多个同类窗口依次排开；尺寸或错开后超出区域时收进区域。
 */
export function centerInArea(
  size: Pick<DisplayRect, 'width' | 'height'>,
  area: DisplayRect,
  offset = 0
): DisplayRect {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  return fitInArea(
    {
      x: area.x + Math.round((area.width - width) / 2) + offset,
      y: area.y + Math.round((area.height - height) / 2) + offset,
      width,
      height
    },
    area
  )
}

function overlapArea(a: DisplayRect, b: DisplayRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** 与矩形交集最大的显示器；与哪块都不相交时为 undefined。 */
function displayOf(
  rect: DisplayRect,
  displays: ReadonlyArray<DisplayArea>
): DisplayArea | undefined {
  let best: DisplayArea | undefined
  let bestArea = 0
  for (const display of displays) {
    const area = overlapArea(rect, display.bounds)
    if (area > bestArea) {
      best = display
      bestArea = area
    }
  }
  return best
}

/**
 * 将记忆解析为建窗几何。与某块显示器有交集：放在交集最大的那块，宽高不低于最小值，收进它的工作区，
 * 最大化 / 全屏照旧。无记忆，或与所有显示器都不相交（如拔掉外接屏）：默认大小摆在主显示器工作区正中。
 * offset：向右下错开（多开时别叠在记忆来源的窗口上）；最大化 / 全屏铺满所在显示器，不错开。
 */
export function resolveWindowPlacement(
  saved: WindowPlacement | null,
  defaults: WindowPlacementDefaults,
  layout: ScreenLayout,
  offset = 0
): WindowPlacement {
  const display = saved === null ? undefined : displayOf(saved, layout.displays)
  if (saved === null || display === undefined) {
    return {
      ...centerInArea(defaults, layout.primaryWorkArea),
      isMaximized: false,
      isFullScreen: false
    }
  }

  const shift = saved.isMaximized || saved.isFullScreen ? 0 : offset
  return {
    ...fitInArea(
      {
        x: saved.x + shift,
        y: saved.y + shift,
        width: Math.max(saved.width, defaults.minWidth),
        height: Math.max(saved.height, defaults.minHeight)
      },
      display.workArea
    ),
    isMaximized: saved.isMaximized,
    isFullScreen: saved.isFullScreen
  }
}
