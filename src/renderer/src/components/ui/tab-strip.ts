// Tab 栏的共用件：项目 Tab 栏（Console）与 Files 的 Editor Tab 行共用同一套外观与行为
// （DESIGN.md「Tab 栏」「Editor Tab 与分栏」）：同高、选中主色下描边、溢出横滚、滚轮直接横滚、激活时滚入视口。
import { useEffect, useLayoutEffect, type RefObject } from 'react'
import type { ClientRect, Modifier } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'

/** Tab 栏外框：40px、`--bg-panel`、底边 1px 分隔 */
export const TAB_BAR = 'h-10 shrink-0 border-b border-[var(--separator)] bg-panel'

/**
 * 左右溢出的通用滚动渐隐遮罩（main.css）：渐变画在这层的两端，所以它只包住滚动区——栏里另有不随 Tab 滚动的按钮
 * （如 Editor Tab 行的「向右分屏」）时，按钮放在这层之外，免得被渐变盖住。底边留 1px 不盖
 */
export const TAB_BAR_FADE =
  'scroll-fade-x relative [--scroll-fade-color:var(--bg-panel)] [--scroll-fade-gutter:1px]'

/** Tab 栏里横向滚动的那一层（滚动条隐藏，见 main.css 的 tab-bar-scroll） */
export const TAB_BAR_SCROLLER =
  'tab-bar-scroll scroll-fade-scroller flex h-full flex-nowrap items-center overflow-x-auto overflow-y-hidden scroll-px-4'

// 单个 Tab 外壳样式：与左标题栏同高、无圆角、彼此紧贴；选中态用主色下描边（inset box-shadow，不占布局）。
// 右内边距 8px：12px 的 × 图标在 16px 按钮内居中内缩 2px，8+2=10px 即图标到右边缘的距离。
export const TAB =
  'flex h-full max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap pl-2.5 text-[14px] transition-colors hover:bg-[var(--bg-row-hover)]'
export const TAB_ACTIVE = { boxShadow: 'inset 0 -3px 0 0 var(--primary)' } as const

// 关闭键：16px 按钮 + 12px 图标；常驻，背景仅 hover 显示（圆形 + 颜色过渡）。
// ml-1 叠加 Tab 的 gap-1.5：文字到关闭键 10px（比文字到左侧图标的 6px 更宽）。
export const TAB_CLOSE =
  'ml-1 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

/** 横向范围（视口坐标） */
export interface HorizontalBounds {
  left: number
  right: number
}

/** Tab 拖拽的位移：仅水平，且把被拖项钳制在 bounds 里 */
export function clampTabDrag(
  transform: Transform,
  draggingNodeRect: ClientRect | null,
  bounds: HorizontalBounds | null
): Transform {
  const t = { ...transform, y: 0 }
  if (!draggingNodeRect || !bounds) return t
  if (draggingNodeRect.left + t.x < bounds.left) {
    t.x = bounds.left - draggingNodeRect.left
  } else if (draggingNodeRect.right + t.x > bounds.right) {
    t.x = bounds.right - draggingNodeRect.right
  }
  return t
}

/** Tab 拖拽：仅水平移动，且钳制在所在的那组 Tab 里（containerNodeRect 即被拖项父容器） */
export const restrictToHorizontalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect
}) => clampTabDrag(transform, draggingNodeRect, containerNodeRect)

/** 悬停在 Tab 栏上时普通滚轮直接横向滚动；触控板已有横向意图时保留其方向 */
export function useWheelScrollsTabs(scrollerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const handleWheel = (e: WheelEvent): void => {
      if (scroller.scrollWidth <= scroller.clientWidth) return

      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return

      const scale =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientWidth
            : 1
      const previous = scroller.scrollLeft
      scroller.scrollLeft += delta * scale
      if (scroller.scrollLeft !== previous) e.preventDefault()
    }

    scroller.addEventListener('wheel', handleWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', handleWheel)
  }, [scrollerRef])
}

/**
 * 激活的 Tab（`data-tab-key` 为 activeKey）不在横向视口里时以最小距离滚进来；scope 变了（换了条目）也重新对一次。
 */
export function useActiveTabIntoView(
  scrollerRef: RefObject<HTMLElement | null>,
  activeKey: string | null,
  scope?: string
): void {
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || activeKey === null) return
    scroller
      .querySelector(`[data-tab-key="${globalThis.CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [scrollerRef, activeKey, scope])
}
