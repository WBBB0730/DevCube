/**
 * Files Tab PPT 预览的纯逻辑（docs/prd/files-pptx-preview.md、ADR-0033）。
 * 页面列表：每页同尺寸（演示文稿只有一个页面尺寸），自上而下排、页间留白，所以几何全是等高行的算术；
 * 缩放只改倍率，页面内容不重画（pptx-renderer 先按原尺寸排好一页再整体 CSS 缩放）。
 */
import { MEDIA_ZOOM_STEP, type MediaFitMode } from './files-media-zoom'

/** 页间留白（CSS px），同 PDF 预览页与页之间 */
export const PPTX_PAGE_GAP = 10
/** 倍率上下限，同 PDF.js viewer（MIN_SCALE / MAX_SCALE） */
export const PPTX_SCALE_MIN = 0.1
export const PPTX_SCALE_MAX = 25

/** 尺寸（CSS px）：幻灯片按 96 DPI 的原尺寸，或滚动视口 */
export type PptxSize = { width: number; height: number }

export function clampPptxScale(scale: number): number {
  return Math.min(PPTX_SCALE_MAX, Math.max(PPTX_SCALE_MIN, scale))
}

/**
 * 四档倍率：`actual` = 幻灯片原尺寸；两条轴 = 该轴刚好铺满视口；`window` = 整页放得下。
 * 视口不留内边距（同 PDF：否则「适应高度」整页看不全），页间留白在页下方。
 */
export function pptxFitScale(mode: MediaFitMode, slide: PptxSize, view: PptxSize): number {
  const byWidth = view.width / slide.width
  const byHeight = view.height / slide.height
  const scale =
    mode === 'actual'
      ? 1
      : mode === 'width'
        ? byWidth
        : mode === 'height'
          ? byHeight
          : Math.min(byWidth, byHeight)
  return clampPptxScale(scale)
}

/**
 * Cmd/Ctrl +/- 逐档，同 PDF.js `updateScale({ steps })`：每档乘 1.1 后按 0.1 取整（放大向上、缩小向下），
 * 档位落在 0.6 / 0.7 / 0.8… 这样的整齐倍率上，两种预览按键的落点一致。
 */
export function pptxStepScale(scale: number, steps: number): number {
  const delta = steps > 0 ? MEDIA_ZOOM_STEP : 1 / MEDIA_ZOOM_STEP
  const round = steps > 0 ? Math.ceil : Math.floor
  let next = scale
  for (let i = Math.abs(steps); i > 0; i--)
    next = round(Number((next * delta).toFixed(2)) * 10) / 10
  return clampPptxScale(next)
}

/** Cmd/Ctrl+滚轮与捏合，同 PDF.js `updateScale({ scaleFactor })`：新倍率按 0.01 取整 */
export function pptxWheelScale(scale: number, factor: number): number {
  return clampPptxScale(Math.round(scale * factor * 100) / 100)
}

/** 一行 = 一页高 + 页间留白 */
export function pptxRowHeight(slide: PptxSize, scale: number): number {
  return slide.height * scale + PPTX_PAGE_GAP
}

/** 页面内容区总尺寸：宽取视口与页宽的大者（页窄于视口时居中），高是全部行减去末页下方留白 */
export function pptxContentSize(
  slide: PptxSize,
  scale: number,
  pages: number,
  view: PptxSize
): PptxSize {
  return {
    width: Math.max(view.width, slide.width * scale),
    height: Math.max(0, pages * pptxRowHeight(slide, scale) - PPTX_PAGE_GAP)
  }
}

/** 页左缘在内容区里的横坐标（窄于视口时居中） */
export function pptxPageLeft(slide: PptxSize, scale: number, view: PptxSize): number {
  return Math.max(0, (view.width - slide.width * scale) / 2)
}

/** 视口内（含上下各 `overscan` 页）要挂载的页，0 起的首尾下标（含）；没有页时 null */
export function pptxVisibleRange(
  scrollTop: number,
  viewHeight: number,
  rowHeight: number,
  pages: number,
  overscan: number
): { first: number; last: number } | null {
  if (pages <= 0 || rowHeight <= 0) return null
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const last = Math.min(pages - 1, Math.floor((scrollTop + viewHeight) / rowHeight) + overscan)
  return first <= last ? { first, last } : null
}

/**
 * 换倍率后的滚动位置：让 `anchor`（视口内坐标）下的页面内容仍在 `anchor` 处。
 * 纵向按「第几页 + 页内比例」换算（页间留白不随倍率缩放）；横向按页内比例（页窄于视口时居中）。
 */
export function pptxScrollAfterZoom({
  scroll,
  anchor,
  view,
  slide,
  from,
  to
}: {
  scroll: { left: number; top: number }
  anchor: { x: number; y: number }
  view: PptxSize
  slide: PptxSize
  from: number
  to: number
}): { left: number; top: number } {
  const rowFrom = pptxRowHeight(slide, from)
  const rowTo = pptxRowHeight(slide, to)
  const hFrom = slide.height * from
  const hTo = slide.height * to
  const y = scroll.top + anchor.y
  const row = Math.max(0, Math.floor(y / rowFrom))
  const inRow = y - row * rowFrom
  // 锚点落在页间留白里：留白不缩放，按它离页底的距离放回
  const yTo = row * rowTo + (inRow <= hFrom ? (inRow / hFrom) * hTo : hTo + (inRow - hFrom))
  const leftFrom = pptxPageLeft(slide, from, view)
  const leftTo = pptxPageLeft(slide, to, view)
  const x = scroll.left + anchor.x
  const xTo = leftTo + ((x - leftFrom) / (slide.width * from)) * (slide.width * to)
  return { left: xTo - anchor.x, top: yTo - anchor.y }
}

/**
 * 当前页（1 起）：原来的页仍整页可见就不变，否则取视口里露出比例最大的一页（并列取靠前的）——同 PDF.js。
 * 这样翻到末尾几页一屏装下时，↓ 仍能逐页前进，页码不会被「最靠上那页」拽回去。
 */
export function pptxCurrentPage({
  scrollTop,
  viewHeight,
  slideHeight,
  rowHeight,
  pages,
  current
}: {
  scrollTop: number
  viewHeight: number
  /** 缩放后的页高 */
  slideHeight: number
  rowHeight: number
  pages: number
  current: number
}): number {
  if (pages <= 0 || viewHeight <= 0 || slideHeight <= 0) return current
  const bottom = scrollTop + viewHeight
  const visible = (page: number): number => {
    const top = (page - 1) * rowHeight
    return Math.max(0, Math.min(top + slideHeight, bottom) - Math.max(top, scrollTop)) / slideHeight
  }
  if (current >= 1 && current <= pages && visible(current) >= 1 - 1e-6) return current
  const first = Math.max(1, Math.floor(scrollTop / rowHeight) + 1)
  const last = Math.min(pages, Math.floor(bottom / rowHeight) + 1)
  let best = current
  let bestRatio = 0
  for (let page = first; page <= last; page++) {
    const ratio = visible(page)
    if (ratio > bestRatio + 1e-6) {
      best = page
      bestRatio = ratio
    }
  }
  return best
}

/**
 * pptx-renderer 查找结果对应的页面元素标记（补丁给每个画出的元素贴 `data-pptx-node="层:编号"`）。
 * 同一编号只在一层（母版 / 版式 / 本页）内唯一，层从结果的 nodePath（`slides/n/master/…`、`slides/n/layout/…`、
 * `slides/n/nodes/…`）取。
 */
export function pptxNodeKey(result: { nodePath: string; nodeId: string }): string {
  const layer = result.nodePath.split('/')[2]
  const origin = layer === 'master' || layer === 'layout' ? layer : 'slide'
  return `${origin}:${result.nodeId}`
}

/**
 * 把一条查找结果落到页面文字上：库的文字按段落以 `\n` 相连，页面上段落之间是换行元素、不占字符，
 * 所以扣掉命中之前的 `\n` 就是页面文字里的偏移。`segments` 是该文本框（或表格格子）内按文档顺序的
 * 文字节点内容（已剔除项目符号与倒影副本）。返回起止所在的节点下标与节点内偏移；页面文字与库的文字
 * 对不上（如公式画成的文字）返回 null，宁可不标也不标错位置。
 */
export function pptxMatchSpan(
  text: string,
  matchStart: number,
  matchEnd: number,
  segments: readonly string[]
): { start: [number, number]; end: [number, number] } | null {
  const toPage = (i: number): number => i - (text.slice(0, i).match(/\n/g)?.length ?? 0)
  const start = toPage(matchStart)
  const end = toPage(matchEnd)
  const normalize = (s: string): string => s.replace(/\u00a0/g, ' ')
  const expected = normalize(text.slice(matchStart, matchEnd).replace(/\n/g, ''))
  if (normalize(segments.join('').slice(start, end)) !== expected || end <= start) return null
  const locate = (offset: number, isEnd: boolean): [number, number] | null => {
    let acc = 0
    for (let i = 0; i < segments.length; i++) {
      const len = segments[i].length
      // 起点落在节点边界时取后一个节点的开头，终点取前一个节点的结尾，免得区间吃进空节点
      if (isEnd ? offset <= acc + len : offset < acc + len) return [i, offset - acc]
      acc += len
    }
    return null
  }
  const s = locate(start, false)
  const e = locate(end, true)
  return s && e ? { start: s, end: e } : null
}
