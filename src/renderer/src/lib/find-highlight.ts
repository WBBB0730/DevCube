/**
 * 预览查找（PPT / Markdown）的命中高亮：CSS Custom Highlight，不动 DOM。注册表是全局的，各预览往同一对
 * Highlight 里增删自己的区间；样式见 main.css（命中黄 / 当前橙，同 PDF）。
 */

const FIND_HIGHLIGHT = 'files-find'
const FIND_CURRENT_HIGHLIGHT = 'files-find-current'

/** 注册表里取（没有就建）一个 Highlight */
function sharedHighlight(name: string, priority: number): Highlight {
  const existing = CSS.highlights.get(name)
  if (existing) return existing
  const highlight = new Highlight()
  highlight.priority = priority
  CSS.highlights.set(name, highlight)
  return highlight
}

/** 全部命中与当前命中两个 Highlight；当前命中优先级更高，与全部命中重叠时显示当前色 */
export function findHighlights(): { all: Highlight; current: Highlight } {
  return {
    all: sharedHighlight(FIND_HIGHLIGHT, 0),
    current: sharedHighlight(FIND_CURRENT_HIGHLIGHT, 1)
  }
}

/** 把命中区间滚到滚动容器的视口正中（同编辑器 / PDF）；横向只在出了视口时才滚 */
export function scrollRangeToCenter(container: HTMLElement, range: Range): void {
  const rect = range.getBoundingClientRect()
  const box = container.getBoundingClientRect()
  container.scrollTop += rect.top + rect.height / 2 - (box.top + container.clientHeight / 2)
  if (rect.left < box.left || rect.right > box.left + container.clientWidth)
    container.scrollLeft += rect.left + rect.width / 2 - (box.left + container.clientWidth / 2)
}
