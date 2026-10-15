// 文件树开窗用的可见区间（StickyTree）：只向 tanstack virtual 取「当前滚到哪几条」，不接管定位——
// 行仍按文档流嵌套排布，目录头的 sticky 逐级吸顶照旧。
import type { RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** 视口上下各多画的条数：滚动时不露白，也让吸顶目录头换层时邻近行已在 */
const OVERSCAN = 10

/**
 * 滚动容器里可见（含上下 overscan）的条目区间 [start, end)。size 给每条的高度；条目种类随下标变化
 * （如提交面板的标题 / 分隔线）时须给 itemKey，且布局一变就换一个新的 itemKey——库按它重算位置。
 */
export function useVisibleRange({
  scrollRef,
  count,
  size,
  itemKey
}: {
  scrollRef: RefObject<HTMLElement | null>
  count: number
  size: (index: number) => number
  itemKey?: (index: number) => string | number
}): { start: number; end: number } {
  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本 hook 的 memo 是预期行为
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: size,
    overscan: OVERSCAN,
    ...(itemKey === undefined ? {} : { getItemKey: itemKey })
  })
  const items = virtualizer.getVirtualItems()
  return items.length === 0
    ? { start: 0, end: 0 }
    : { start: items[0].index, end: items[items.length - 1].index + 1 }
}
