/**
 * Files Tab 分页文档（PDF / PPT）缩略图侧栏的纯逻辑：小图尺寸、侧栏视口，以及按视口排画图优先级
 *（PDF 渲染器一次只画一张，靠它决定下一张画哪页；PPT 的小图随格子挂载即画，不排队）。
 */

/** 小图框宽（CSS px），即侧栏能给小图的最大宽 */
export const PAGE_THUMB_W = 128
/**
 * 小图框高（CSS px）= A4 竖页比例（1:√2）：A / B 系列与 Letter 用满框宽，最高的一格就是一张 A4；
 * 更长的页（Legal、竖屏截图、长网页导出）顶住它等比缩窄。取不压窄 A4 的最低值，再低最常见的页也要变窄
 */
export const PAGE_THUMB_MAX_H = Math.round(PAGE_THUMB_W * Math.SQRT2)

/** 小图尺寸（CSS px） */
export type PageThumbSize = { width: number; height: number }

/** 页面（任意单位）缩成小图的倍率：保持宽高比装进小图框，宽页用满框宽、超长页顶住框高 */
export function pageThumbScale(pageWidth: number, pageHeight: number): number {
  return Math.min(PAGE_THUMB_W / pageWidth, PAGE_THUMB_MAX_H / pageHeight)
}

/** 页面（任意单位）的小图尺寸；极端宽高比下短边至少 1px，格子不塌成 0 */
export function pageThumbSize(pageWidth: number, pageHeight: number): PageThumbSize {
  const scale = pageThumbScale(pageWidth, pageHeight)
  return {
    width: Math.max(1, Math.round(pageWidth * scale)),
    height: Math.max(1, Math.round(pageHeight * scale))
  }
}

export type ThumbnailWindow = {
  /** 侧栏视口内首尾页（1 起，含） */
  first: number
  last: number
  /** 侧栏最近一次的滚动方向 */
  direction: 'forward' | 'backward'
}

/**
 * 下一张该画的页：视口内未画的按顺序优先；然后顺着滚动方向往前预取 `ahead` 页，再反方向补 `behind` 页。
 * 都画好了返回 null。
 */
export function nextThumbnailPage(
  win: ThumbnailWindow,
  pages: number,
  done: (page: number) => boolean,
  ahead: number,
  behind: number
): number | null {
  const first = Math.max(1, win.first)
  const last = Math.min(pages, win.last)
  for (let n = first; n <= last; n++) if (!done(n)) return n
  const forward = win.direction === 'forward'
  for (let d = 1; d <= ahead; d++) {
    const n = forward ? last + d : first - d
    if (n >= 1 && n <= pages && !done(n)) return n
  }
  for (let d = 1; d <= behind; d++) {
    const n = forward ? first - d : last + d
    if (n >= 1 && n <= pages && !done(n)) return n
  }
  return null
}
