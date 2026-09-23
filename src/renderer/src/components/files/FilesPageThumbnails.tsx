// Files Tab · 分页文档（PDF / PPT）缩略图侧栏：正文左侧一列每页小图，点击跳页；正文翻到哪页，那格点亮并以最小距离滚入视口。
// 格子里画什么由调用方给（PDF 是渲染器缓存的小图，PPT 是缩小画的整页）；这里只管列表：用 @tanstack/react-virtual
//（文件树同款）只挂视口内的格子，并把视口首尾页与滚动方向告诉调用方（PDF 渲染器据此定画图优先级）。
// 侧栏固定宽、不可拖（DESIGN.md 侧栏规矩）。
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@renderer/lib/utils'
import { PAGE_THUMB_W, type ThumbnailWindow } from '@renderer/lib/files-page-thumbnails'

/** 统一留白：侧栏内边距、格子内边距、小图到页码、页码到底边、格子之间，全部同值 */
const GAP = 8
/** 全局细滚动条宽度；槽常驻以免页数少时格子变宽 */
const SCROLLBAR_W = 8
/** 侧栏总宽 = 侧栏两侧留白 + 格子两侧留白 + 小图 + 滚动条槽 */
const STRIP_W = 4 * GAP + PAGE_THUMB_W + SCROLLBAR_W
/** 格子额外高度：上留白 + 小图到页码 + 页码行 16px（12px 字）+ 下留白 + 格子间留白 */
const CELL_CHROME = 4 * GAP + 16

function ThumbCell({
  page,
  height,
  selected,
  onSelect,
  children
}: {
  page: number
  /** 小图高（CSS px），按该页真实宽高比算出 */
  height: number
  selected: boolean
  onSelect: (page: number) => void
  /** 小图内容；还没有时为空，格子就是一张白页占位 */
  children: React.ReactNode
}): React.JSX.Element {
  return (
    // 三态底色：常态 --bg-panel（比侧栏的 deepest 亮一档）→ hover --bg-row-hover → 选中 --selection-row（同树行）
    <button
      type="button"
      title={`第 ${page} 页`}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center rounded transition-colors',
        selected ? 'bg-[var(--selection-row)]' : 'bg-panel hover:bg-[var(--bg-row-hover)]'
      )}
      style={{ padding: GAP, gap: GAP }}
      onClick={() => onSelect(page)}
    >
      {/* 白底 + 阴影同正文页面；内容不接指针，整格都是一颗钮 */}
      <div
        className="pointer-events-none overflow-hidden bg-white shadow-[0_1px_4px_rgb(0_0_0/0.35)]"
        style={{ width: PAGE_THUMB_W, height }}
      >
        {children}
      </div>
      <span
        className={cn(
          'text-[12px] leading-4 tabular-nums',
          selected ? 'text-[color:var(--fg-primary)]' : 'text-[color:var(--fg-info)]'
        )}
      >
        {page}
      </span>
    </button>
  )
}

export function FilesPageThumbnails({
  heights,
  page,
  onSelect,
  renderThumb,
  onWindowChange
}: {
  /** 每页小图高（CSS px）；null = 文档尚在加载，只出侧栏空壳以免正文宽度来回跳 */
  heights: readonly number[] | null
  /** 正文当前页（1 起） */
  page: number
  onSelect: (page: number) => void
  /** 第 n 页（1 起）的小图内容，只对挂在视口内的格子调用 */
  renderThumb: (page: number) => React.ReactNode
  /** 视口首尾页与滚动方向；null = 侧栏收起 */
  onWindowChange?: (win: ThumbnailWindow | null) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  // 尺寸是一次性算好的（组件按文档 key 重挂），count 从 0 变 N 时虚拟器整表重算，estimateSize 不必再触发 measure
  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本组件 memo 是预期行为
  const virtualizer = useVirtualizer({
    count: heights?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (heights?.[i] ?? 0) + CELL_CHROME,
    overscan: 2
  })

  // 视口首尾页与滚动方向交给调用方定优先级；停下来时方向为 null，沿用最近一次
  const range = virtualizer.range
  const first = range ? range.startIndex + 1 : 0
  const last = range ? range.endIndex + 1 : 0
  const scrollDirection = virtualizer.scrollDirection
  const directionRef = useRef<'forward' | 'backward'>('forward')
  useEffect(() => {
    if (scrollDirection) directionRef.current = scrollDirection
    if (!onWindowChange || first <= 0) return
    onWindowChange({ first, last, direction: directionRef.current })
  }, [onWindowChange, first, last, scrollDirection])
  // 侧栏收起（卸载）就不再预取
  useEffect(() => () => onWindowChange?.(null), [onWindowChange])

  // 正文翻页：当前格不在视口内才滚（align auto），点缩略图跳页时它本就可见、不动
  useEffect(() => {
    if (!heights) return
    virtualizer.scrollToIndex(page - 1, { align: 'auto' })
  }, [page, heights, virtualizer])

  return (
    <div
      ref={scrollRef}
      className="h-full shrink-0 overflow-y-auto border-r border-[var(--separator)] bg-deepest [scrollbar-gutter:stable]"
      style={{ width: STRIP_W, padding: GAP }}
    >
      {heights && (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${vi.start}px)`, paddingBottom: GAP }}
            >
              <ThumbCell
                page={vi.index + 1}
                height={heights[vi.index]}
                selected={vi.index + 1 === page}
                onSelect={onSelect}
              >
                {renderThumb(vi.index + 1)}
              </ThumbCell>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
