/**
 * Files 看图相机：缩放倍率相对「适配视口且不放大」；同一相机驱动 `<img>` 层与瓦片层（ADR-0029）。
 * 手感常量经人工调校，改前先试。
 */
export const MEDIA_ZOOM_MIN = 0.1
export const MEDIA_ZOOM_MAX = 32
/** 鼠标一格（deltaY≈100）约 10%。 */
const MEDIA_ZOOM_WHEEL = 0.001
/**
 * Chromium 没有 Safari 的 GestureEvent，触控板捏合被合成成 ctrl+wheel，deltaY = 100 * ln(增量 scale)；
 * 还原手指比例是 exp(-deltaY/100)。Chrome 页缩放弱于 AppKit 捏合
 *（FlowVision `NSMagnificationGestureRecognizer`，sensitivity=1），×2.5 接近原生。
 */
const MEDIA_ZOOM_PINCH = 0.025
/** 键盘 Cmd/Ctrl +/- 一档的倍数；取 PDF.js 的 `DEFAULT_SCALE_DELTA`，两种预览手感一致。 */
export const MEDIA_ZOOM_STEP = 1.1

export type MediaCamera = { zoom: number; x: number; y: number }

/** 适应轴：`width` = 宽度刚好铺满视口，`height` = 高度刚好铺满视口。 */
export type MediaFitAxis = 'width' | 'height'

/**
 * 工具栏四档：`actual` = 1:1（像素对像素，PDF 则是纸张实际尺寸）、两条轴、
 * `window` = 整个显示得下且小图不放大。
 * `window` 是独立一档而不是「挑出较小的那条轴」：轴钉死后视口比例一变就可能让另一轴溢出，
 * 而这一档每次按新尺寸重算，「整个看得见」一直成立（同 Acrobat Fit Page / 预览 Zoom to Fit）。
 */
export type MediaFitMode = 'actual' | MediaFitAxis | 'window'

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

/** 原图像素 → CSS 像素的绘制倍率（含适配与用户缩放）。 */
export function mediaDrawScale(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number,
  zoom: number
): number {
  return fitBaseScale(naturalW, naturalH, availW, availH) * zoom
}

export function mediaDisplaySize(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number,
  zoom: number
): { w: number; h: number } {
  const s = mediaDrawScale(naturalW, naturalH, availW, availH, zoom)
  return { w: naturalW * s, h: naturalH * s }
}

/** 该轴刚好铺满视口所需的倍率（相对「适配视口且不放大」的基准）；算不出返回 null。 */
export function mediaFitZoom(
  axis: MediaFitAxis,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): number | null {
  if (naturalW <= 0 || naturalH <= 0 || availW <= 0 || availH <= 0) return null
  const base = fitBaseScale(naturalW, naturalH, availW, availH)
  if (base <= 0) return null
  return clampMediaZoom((axis === 'width' ? availW / naturalW : availH / naturalH) / base)
}

/**
 * 1:1（像素对像素）所需的倍率：抵消掉「适配视口」的基准，让绘制倍率回到 1。
 * 图本就比视口小时基准已是 1，这一档与「适应窗口」同形。
 */
export function mediaActualZoom(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): number | null {
  if (naturalW <= 0 || naturalH <= 0 || availW <= 0 || availH <= 0) return null
  const base = fitBaseScale(naturalW, naturalH, availW, availH)
  return base <= 0 ? null : clampMediaZoom(1 / base)
}

/**
 * 「适应窗口」这一档实际顶住的是哪条轴：内容比视口更「扁」宽度先铺满，更「高」则高度先铺满。
 * 双击换档要先知道眼下落在哪条轴上，才能切到另一条。只看两边的宽高比，与当前倍率无关。
 */
export function mediaFitWindowAxis(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): MediaFitAxis {
  return availW * naturalH <= availH * naturalW ? 'width' : 'height'
}

/** 图整个放得下视口（不放大也装得下）——打开时落 1:1 还是「适应窗口」看这个。 */
export function mediaFitsViewport(
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): boolean {
  return naturalW > 0 && naturalH > 0 && naturalW <= availW && naturalH <= availH
}

export function clampMediaCamera(
  cam: MediaCamera,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): MediaCamera {
  const s = mediaDrawScale(naturalW, naturalH, availW, availH, cam.zoom)
  const dw = naturalW * s
  const dh = naturalH * s
  return {
    zoom: cam.zoom,
    x: dw <= availW ? (availW - dw) / 2 : Math.min(0, Math.max(availW - dw, cam.x)),
    y: dh <= availH ? (availH - dh) / 2 : Math.min(0, Math.max(availH - dh, cam.y))
  }
}

export function centerMediaCamera(
  zoom: number,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): MediaCamera {
  const s = mediaDrawScale(naturalW, naturalH, availW, availH, zoom)
  return clampMediaCamera(
    { zoom, x: (availW - naturalW * s) / 2, y: (availH - naturalH * s) / 2 },
    naturalW,
    naturalH,
    availW,
    availH
  )
}

/** 缩放后让光标下的图上点仍在光标下，再夹紧平移。 */
export function zoomMediaCameraAt(
  cam: MediaCamera,
  nextZoom: number,
  cursorX: number,
  cursorY: number,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): MediaCamera {
  const z = clampMediaZoom(nextZoom)
  const s0 = mediaDrawScale(naturalW, naturalH, availW, availH, cam.zoom)
  const s1 = mediaDrawScale(naturalW, naturalH, availW, availH, z)
  const imgX = s0 === 0 ? 0 : (cursorX - cam.x) / s0
  const imgY = s0 === 0 ? 0 : (cursorY - cam.y) / s0
  return clampMediaCamera(
    { zoom: z, x: cursorX - imgX * s1, y: cursorY - imgY * s1 },
    naturalW,
    naturalH,
    availW,
    availH
  )
}

export function panMediaCamera(
  cam: MediaCamera,
  dx: number,
  dy: number,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): MediaCamera {
  return clampMediaCamera(
    { zoom: cam.zoom, x: cam.x - dx, y: cam.y - dy },
    naturalW,
    naturalH,
    availW,
    availH
  )
}

/**
 * 相机 → OpenSeadragon 视口（图宽归一化为 1，y 也按图宽计）：
 * zoom = 显示宽 / 视口宽；center = 视口中点对应的图上点。
 */
export function mediaCameraToViewport(
  cam: MediaCamera,
  naturalW: number,
  naturalH: number,
  availW: number,
  availH: number
): { zoom: number; centerX: number; centerY: number } {
  const s = mediaDrawScale(naturalW, naturalH, availW, availH, cam.zoom)
  if (s <= 0 || availW <= 0 || naturalW <= 0) {
    return { zoom: 1, centerX: 0.5, centerY: naturalW > 0 ? naturalH / naturalW / 2 : 0.5 }
  }
  return {
    zoom: (naturalW * s) / availW,
    centerX: (availW / 2 - cam.x) / s / naturalW,
    centerY: (availH / 2 - cam.y) / s / naturalW
  }
}
