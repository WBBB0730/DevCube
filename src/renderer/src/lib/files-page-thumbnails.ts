/**
 * Files Tab 分页文档（PDF / PPT）缩略图侧栏的纯逻辑：小图尺寸、侧栏视口，以及按视口排画图优先级
 *（PDF 渲染器一次只画一张，靠它决定下一张画哪页；PPT 的小图随格子挂载即画，不排队）。
 */

/** 小图宽（CSS px），高按每页真实宽高比 */
export const PAGE_THUMB_W = 128

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
