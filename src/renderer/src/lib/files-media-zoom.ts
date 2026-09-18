/** Files 看图：缩放倍率相对「适配视口且不放大」（与原先 max-h/w-full object-contain 一致）。 */
export const MEDIA_ZOOM_MIN = 0.1
export const MEDIA_ZOOM_MAX = 32
/** 鼠标一格（deltaY≈100）约 10%。 */
const MEDIA_ZOOM_WHEEL = 0.001
/**
 * Chromium 把捏合成合成 ctrl+wheel，deltaY = 100 * ln(增量 scale)；
 * 还原手指比例是 exp(-deltaY/100)。Chrome 页缩放弱于 AppKit 捏合
 *（FlowVision `NSMagnificationGestureRecognizer`，sensitivity=1），×2.5 接近原生。
 */
const MEDIA_ZOOM_PINCH = 0.025

export function clampMediaZoom(zoom: number): number {
  return Math.min(MEDIA_ZOOM_MAX, Math.max(MEDIA_ZOOM_MIN, zoom))
}

export function isPinchZoomWheel(e: {
  deltaY: number
  deltaMode?: number
  ctrlKey?: boolean
  metaKey?: boolean
}): boolean {
  return !!e.ctrlKey && !e.metaKey && (e.deltaMode ?? 0) === 0 && Math.abs(e.deltaY) < 80
}

/** Cmd/Ctrl+滚轮或触控板捏合：deltaY>0 缩小。 */
export function zoomFromWheel(
  zoom: number,
  deltaY: number,
  gesture?: { deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean }
): number {
  const mode = gesture?.deltaMode ?? 0
  let dy = deltaY
  if (mode === 1) dy *= 16
  else if (mode === 2) dy *= 400
  const gain = isPinchZoomWheel({
    deltaY,
    deltaMode: mode,
    ctrlKey: gesture?.ctrlKey,
    metaKey: gesture?.metaKey
  })
    ? MEDIA_ZOOM_PINCH
    : MEDIA_ZOOM_WHEEL
  return clampMediaZoom(zoom * Math.exp(-dy * gain))
}

/** zoom=1 时的基准：小图保持像素尺寸，大图缩小以完整放入视口。 */
export function fitBaseScale(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): number {
  if (naturalW <= 0 || naturalH <= 0 || availW <= 0 || availH <= 0) return 1
  return Math.min(1, availW / naturalW, availH / naturalH)
}

export function mediaDisplaySize(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number,
  zoom: number
): { w: number; h: number } {
  const base = fitBaseScale(naturalW, naturalH, availW, availH)
  return { w: naturalW * base * zoom, h: naturalH * base * zoom }
}

/** 视口坐标 + 滚动 → 当前显示图上的点（图居中于 min 视口大的衬底时）。 */
export function imagePointFromCursor(args: {
  cursorX: number
  cursorY: number
  scrollLeft: number
  scrollTop: number
  viewportW: number
  viewportH: number
  displayW: number
  displayH: number
}): { x: number; y: number } {
  const offsetX = (Math.max(args.displayW, args.viewportW) - args.displayW) / 2
  const offsetY = (Math.max(args.displayH, args.viewportH) - args.displayH) / 2
  return {
    x: args.scrollLeft + args.cursorX - offsetX,
    y: args.scrollTop + args.cursorY - offsetY
  }
}

/** 让指定图上的点落在光标下（缩放后保持指针对准同一像素）。 */
export function scrollToImagePoint(args: {
  imageX: number
  imageY: number
  cursorX: number
  cursorY: number
  viewportW: number
  viewportH: number
  displayW: number
  displayH: number
}): { left: number; top: number } {
  const offsetX = (Math.max(args.displayW, args.viewportW) - args.displayW) / 2
  const offsetY = (Math.max(args.displayH, args.viewportH) - args.displayH) / 2
  return {
    left: args.imageX + offsetX - args.cursorX,
    top: args.imageY + offsetY - args.cursorY
  }
}
