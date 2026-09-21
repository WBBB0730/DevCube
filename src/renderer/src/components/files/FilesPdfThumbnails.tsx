// Files Tab · PDF 缩略图侧栏：正文左侧一列每页小图，点击跳页；正文翻到哪页，那格点亮并以最小距离滚入视口。
// 画图、排队与缓存在 PdfThumbnailRenderer（lib/files-pdf-thumbnails；一份文档一个，归 PDF 预览持有，侧栏开合不丢缓存）。
// 这里只管列表：用 @tanstack/react-virtual（文件树同款）只挂视口内的格子，把视口首尾页与滚动方向告诉渲染器定优先级，
// 格子拿到小图 URL 就显示。侧栏固定宽、不可拖（DESIGN.md 侧栏规矩）。
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@renderer/lib/utils'
import { PDF_THUMB_W, type PdfThumbnailRenderer } from '@renderer/lib/files-pdf-thumbnails'

/** 统一留白：侧栏内边距、格子内边距、小图到页码、页码到底边、格子之间，全部同值 */
const GAP = 8
/** 全局细滚动条宽度；槽常驻以免页数少时格子变宽 */
const SCROLLBAR_W = 8
/** 侧栏总宽 = 侧栏两侧留白 + 格子两侧留白 + 小图 + 滚动条槽 */
const STRIP_W = 4 * GAP + PDF_THUMB_W + SCROLLBAR_W
/** 格子额外高度：上留白 + 小图到页码 + 页码行 16px（12px 字）+ 下留白 + 格子间留白 */
const CELL_CHROME = 4 * GAP + 16

const noSubscribe = (): (() => void) => () => {}
const zero = (): number => 0

function ThumbCell({
  url,
  page,
  height,
  selected,
  onSelect
}: {
  /** 画好的小图；undefined = 还在排队，先出白页占位 */
  url: string | undefined
  page: number
  /** 小图高（CSS px），按该页真实宽高比算出 */
  height: number
  selected: boolean
  onSelect: (page: number) => void
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
      {/* 白底 + 阴影同正文页面；小图未就绪时就是一张白页占位 */}
      <div
        className="bg-white shadow-[0_1px_4px_rgb(0_0_0/0.35)]"
        style={{ width: PDF_THUMB_W, height }}
      >
        {url && <img src={url} alt="" draggable={false} className="block size-full" />}
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

export function FilesPdfThumbnails({
  renderer,
  page,
  onSelect
}: {
  /** 当前文档的渲染器；null = 文档尚在加载，只出侧栏空壳以免正文宽度来回跳 */
  renderer: PdfThumbnailRenderer | null
  /** 正文当前页（1 起） */
  page: number
  onSelect: (page: number) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  // 渲染器尺寸取齐或画好一张就通知一次，这里跟着重渲染
  useSyncExternalStore(
    renderer ? renderer.subscribe : noSubscribe,
    renderer ? renderer.getVersion : zero
  )
  const heights = renderer?.heights ?? null

  // 尺寸是一次性算好的（组件按文档 key 重挂），count 从 0 变 N 时虚拟器整表重算，estimateSize 不必再触发 measure
  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本组件 memo 是预期行为
  const virtualizer = useVirtualizer({
    count: heights?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (heights?.[i] ?? 0) + CELL_CHROME,
    overscan: 2
  })

  // 视口首尾页与滚动方向交给渲染器定优先级；停下来时方向为 null，沿用最近一次
  const range = virtualizer.range
  const first = range ? range.startIndex + 1 : 0
  const last = range ? range.endIndex + 1 : 0
  const scrollDirection = virtualizer.scrollDirection
  const directionRef = useRef<'forward' | 'backward'>('forward')
  useEffect(() => {
    if (scrollDirection) directionRef.current = scrollDirection
    if (!renderer || first <= 0) return
    renderer.setWindow({ first, last, direction: directionRef.current })
  }, [renderer, first, last, scrollDirection])
  // 侧栏收起（卸载）就不再预取；已画好的留在渲染器里
  useEffect(() => () => renderer?.setWindow(null), [renderer])

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
      {renderer && heights && (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${vi.start}px)`, paddingBottom: GAP }}
            >
              <ThumbCell
                url={renderer.url(vi.index + 1)}
                page={vi.index + 1}
                height={heights[vi.index]}
                selected={vi.index + 1 === page}
                onSelect={onSelect}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
