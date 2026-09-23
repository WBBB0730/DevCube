// Files Tab · PPT 预览：pptx-renderer（@aiden0z/pptx-renderer）把每页画成 HTML / SVG，页面列表、四档缩放、翻页、
// 查找与缩略图是 DevCube 的壳（ADR-0033）；键盘、抓手、滚轮缩放、页码与四档、缩略图侧栏与 PDF 预览共用
//（lib/files-paged-preview、FilesPagedControls、FilesPageThumbnails），几何与查找换算在 lib/files-pptx。
// - 不用库自带的整套查看器：它每改一次倍率就清空重画、自管滚动，与四档 / 按光标缩放 / 缩略图对不上。这里用库的
//   单页渲染自己排列表：每页挂载时画一次、缩放只改 CSS 倍率（库本就先按原尺寸排好再整体缩放，文字始终清晰）；
//   演示文稿每页同尺寸，只挂视口内（上下各多一页）的页，行位置按等高行直接算。
// - 查找：库的全文检索给命中（没挂载的页也搜得到）；高亮用浏览器的 CSS Custom Highlight，只标命中的字、不改页面。
//   命中落到页面文字靠补丁贴的标记（元素编号 / 表格格子 / 项目符号，见 patches/ 与 ADR-0033）。
// - 链接：文字里的网址是库生成的 <a target=_blank>，走 Chromium 开窗请求 → 主进程守卫 → 系统浏览器（同 PDF）；
//   跳页与图形上的链接经 onNavigate 回来，网址交主进程 openExternal（同一份白名单）。
// - 文件经 dc-media 一次取回；媒体按需解码，ZIP 按库推荐的限额解压（防压缩炸弹）；宏不执行（库不碰）。
// - EMF 里内嵌 PDF 的矢量插图不画（库要在后台线程加载 PDF.js，见 PRD Out of Scope）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  buildPresentation,
  buildTextIndex,
  parseZipLazyMedia,
  RECOMMENDED_ZIP_LIMITS,
  renderSlide,
  searchText,
  type PresentationData,
  type SlideHandle,
  type SlideRendererOptions,
  type TextSearchResult
} from '@aiden0z/pptx-renderer'
import { cn } from '@renderer/lib/utils'
import {
  mediaFitWindowAxis,
  type MediaFitAxis,
  type MediaFitMode
} from '@renderer/lib/files-media-zoom'
import { PAGE_THUMB_W } from '@renderer/lib/files-page-thumbnails'
import {
  useCtrlWheelZoom,
  usePagedPreviewKeys,
  usePreviewPan
} from '@renderer/lib/files-paged-preview'
import {
  clampPptxScale,
  pptxContentSize,
  pptxCurrentPage,
  pptxFitScale,
  pptxMatchSpan,
  pptxNodeKey,
  pptxPageLeft,
  pptxRowHeight,
  pptxScrollAfterZoom,
  pptxStepScale,
  pptxVisibleRange,
  pptxWheelScale,
  type PptxSize
} from '@renderer/lib/files-pptx'
import { FilesPageControls, FilesPreviewError, FilesThumbnailsToggle } from './FilesPagedControls'
import { FilesPageThumbnails } from './FilesPageThumbnails'
import { FilesToolbar, type FilesToolbarProps } from './FilesToolbar'
import { FindBar } from './FindBar'

/** 查找高亮在 CSS Custom Highlight 注册表里的名字（样式见 main.css）；各预览往同一个 Highlight 里增删自己的区间 */
const FIND_HIGHLIGHT = 'files-pptx-find'
const FIND_CURRENT_HIGHLIGHT = 'files-pptx-find-current'

/** 一份已打开的演示文稿：各页共用的媒体对象 URL（关文档时统一回收）、图表实例与链接回调 */
type PptxDoc = {
  presentation: PresentationData
  slide: PptxSize
  mediaUrlCache: Map<string, string>
  chartInstances: NonNullable<SlideRendererOptions['chartInstances']>
  navigate: NonNullable<SlideRendererOptions['onNavigate']>
}

/** 注册表里取（没有就建）一个 Highlight；当前命中那个优先级更高，与全部命中重叠时显示当前色 */
function sharedHighlight(name: string, priority: number): Highlight {
  const existing = CSS.highlights.get(name)
  if (existing) return existing
  const highlight = new Highlight()
  highlight.priority = priority
  CSS.highlights.set(name, highlight)
  return highlight
}

/** 一条查找结果在已挂载的页上对应的文字区间；元素没画出来或文字对不上（如公式）为 null */
function matchRange(slideEl: HTMLElement, match: TextSearchResult): Range | null {
  const nodeEl = slideEl.querySelector(`[data-pptx-node="${CSS.escape(pptxNodeKey(match))}"]`)
  const scope =
    nodeEl && match.textKind === 'table-cell'
      ? nodeEl.querySelector(`[data-pptx-cell="${match.rowIndex}:${match.cellIndex}"]`)
      : nodeEl
  if (!scope) return null
  // 项目符号与倒影副本不是正文
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('[data-pptx-bullet], [data-pptx-reflection-layer]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
  })
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  const span = pptxMatchSpan(
    match.text,
    match.matchStart,
    match.matchEnd,
    texts.map((t) => t.data)
  )
  if (!span) return null
  const range = document.createRange()
  range.setStart(texts[span.start[0]], span.start[1])
  range.setEnd(texts[span.end[0]], span.end[1])
  return range
}

/** 文字、链接与媒体控件上的鼠标动作让给选字与点击（抓手与双击都照此让路）；指针变手指的地方都算可点 */
function overTextOrClickable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('a, button, input, select, textarea, video, audio')) return true
  if (getComputedStyle(target).cursor === 'pointer') return true
  return [...target.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
}

/** 一页：挂载时交库画一次，之后只随倍率改 CSS 缩放；卸载时释放该页的图表等资源 */
function PptxSlideView({
  doc,
  index,
  scale,
  className,
  onRendered
}: {
  doc: PptxDoc
  /** 0 起 */
  index: number
  scale: number
  className?: string
  /** 画好（元素）/ 卸载（null）时通知，查找高亮据此找页面文字 */
  onRendered?: (index: number, el: HTMLElement | null) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const data = doc.presentation.slides[index]
    if (!host || !data) return
    let handle: SlideHandle
    try {
      handle = renderSlide(doc.presentation, data, {
        onNavigate: doc.navigate,
        mediaUrlCache: doc.mediaUrlCache,
        chartInstances: doc.chartInstances,
        pdfjs: false
      })
    } catch {
      return // 这一页画不出来：留白页
    }
    handle.element.style.transformOrigin = '0 0'
    host.appendChild(handle.element)
    slideRef.current = handle.element
    onRendered?.(index, handle.element)
    return () => {
      onRendered?.(index, null)
      slideRef.current = null
      handle.dispose()
      handle.element.remove()
    }
  }, [doc, index, onRendered])

  useLayoutEffect(() => {
    if (slideRef.current) slideRef.current.style.transform = `scale(${scale})`
  }, [doc, index, scale])

  return (
    <div
      ref={hostRef}
      className={cn('overflow-hidden bg-white', className)}
      style={{ width: doc.slide.width * scale, height: doc.slide.height * scale }}
    />
  )
}

export function FilesPptxPreview({
  src,
  path,
  active,
  thumbnails,
  onToggleThumbnails,
  onPrev,
  onNext,
  toolbar
}: {
  src: string
  path: string
  /** Files Tab 可见时才响应键盘 */
  active: boolean
  /** ←/→ 切上一个 / 下一个媒体文件（↑/↓ 归翻页）；由 FilesPane 按树内可见序给 */
  onPrev?: () => void
  onNext?: () => void
  /** 缩略图侧栏可见性（会话内保持，归 FilesPane，与 PDF 共用） */
  thumbnails: boolean
  onToggleThumbnails: () => void
  toolbar: Omit<
    FilesToolbarProps,
    'path' | 'error' | 'extra' | 'pathExtra' | 'sourcePreview' | 'onToggleSourcePreview'
  >
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<{ src: string; doc: PptxDoc } | null>(null)
  const [loadError, setLoadError] = useState<{ src: string; message: string } | null>(null)
  const [scale, setScale] = useState(1)
  /** 当前所处的档；null = 滚轮缩出的自由倍率，四颗钮都不亮 */
  const [fitMode, setFitMode] = useState<MediaFitMode | null>('window')
  const [view, setView] = useState<PptxSize>({ width: 0, height: 0 })
  const [scrollTop, setScrollTop] = useState(0)
  const [page, setPage] = useState(1)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  /** 这次查找从第几页起（打开查找 / 改查询时的当前页），首个命中取这页及之后的第一个，同 PDF */
  const [findFromPage, setFindFromPage] = useState(1)
  /** 上一个 / 下一个选中的命中下标；null = 取 `findFromPage` 起的首个 */
  const [activeMatch, setActiveMatch] = useState<number | null>(null)
  /** 最近一次请求的倍率与待落的滚动位置：连续滚轮在一帧里多次换倍率时以它们为基准，而不是还没提交的 DOM */
  const scaleRef = useRef(1)
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  /** 已挂载的页（0 起）→ 页元素，查找高亮用 */
  const slideEls = useRef(new Map<number, HTMLElement>())
  /** 待滚到视口正中的命中（换了当前命中时记下，页挂上、文字区间找到后执行） */
  const revealRef = useRef<TextSearchResult | null>(null)
  /** 上次发起滚动的命中：只有当前命中换了才滚，缩放等重渲染不再把视口拽回命中处 */
  const revealedFor = useRef<TextSearchResult | null>(null)
  /** 链接回调里的跳页（文档对象建一次，跳页随渲染更新） */
  const goToPageRef = useRef<(page: number) => void>(() => {})

  const doc = loaded?.src === src ? loaded.doc : null
  const error = loadError?.src === src ? loadError.message : null
  const pages = doc?.presentation.slides.length ?? 0
  const slide = doc?.slide ?? null
  const rowH = slide ? pptxRowHeight(slide, scale) : 0

  // 取文件、解析；换文件或卸载时回收对象 URL（各页的图表等资源随页卸载释放）
  useEffect(() => {
    let dead = false
    let mediaUrlCache: Map<string, string> | null = null
    void (async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`读取失败（${res.status}）`)
        const buffer = await res.arrayBuffer()
        if (dead) return
        const files = await parseZipLazyMedia(buffer, RECOMMENDED_ZIP_LIMITS)
        if (dead) return
        const presentation = buildPresentation(files)
        const next: PptxDoc = {
          presentation,
          slide: { width: presentation.width, height: presentation.height },
          mediaUrlCache: new Map(),
          chartInstances: new Set(),
          navigate: (target) => {
            if (target.slideIndex !== undefined) goToPageRef.current(target.slideIndex + 1)
            else if (target.url) void window.api.openExternal(target.url)
          }
        }
        mediaUrlCache = next.mediaUrlCache
        // 打开即整页显示得下（同看图 / PDF）
        const container = containerRef.current
        const viewNow = container
          ? { width: container.clientWidth, height: container.clientHeight }
          : { width: 0, height: 0 }
        const initial = pptxFitScale('window', next.slide, viewNow)
        if (viewNow.width > 0 && viewNow.height > 0) setView(viewNow)
        scaleRef.current = initial
        pendingScroll.current = null
        if (container) {
          container.scrollTop = 0
          container.scrollLeft = 0
          container.focus({ preventScroll: true })
        }
        setLoaded({ src, doc: next })
        setScale(initial)
        setFitMode('window')
        setScrollTop(0)
        setPage(1)
      } catch (e) {
        if (!dead) setLoadError({ src, message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      dead = true
      for (const url of mediaUrlCache?.values() ?? []) URL.revokeObjectURL(url)
    }
  }, [src])

  /**
   * 换倍率：让 `anchor`（视口内坐标）下的内容留在原处，同步给出新的滚动位置与当前页；
   * 页面内容不重画，只随倍率改 CSS 缩放。`mode` 为所处的档（null = 自由倍率）。
   */
  const applyScale = useCallback(
    (next: number, mode: MediaFitMode | null, anchor: { x: number; y: number }) => {
      const container = containerRef.current
      if (!container || !doc) return
      const to = clampPptxScale(next)
      const from = scaleRef.current
      setFitMode(mode)
      if (to === from) return
      const viewNow = { width: container.clientWidth, height: container.clientHeight }
      const target = pptxScrollAfterZoom({
        scroll: pendingScroll.current ?? { left: container.scrollLeft, top: container.scrollTop },
        anchor,
        view: viewNow,
        slide: doc.slide,
        from,
        to
      })
      const content = pptxContentSize(doc.slide, to, doc.presentation.slides.length, viewNow)
      const top = Math.max(0, Math.min(target.top, content.height - viewNow.height))
      pendingScroll.current = { left: Math.max(0, target.left), top }
      scaleRef.current = to
      setScale(to)
      setScrollTop(top)
      setPage((prev) =>
        pptxCurrentPage({
          scrollTop: top,
          viewHeight: viewNow.height,
          slideHeight: doc.slide.height * to,
          rowHeight: pptxRowHeight(doc.slide, to),
          pages: doc.presentation.slides.length,
          current: prev
        })
      )
    },
    [doc]
  )

  // 新倍率的内容尺寸已提交，这时再落滚动位置（先落会被旧的内容尺寸夹住）
  useLayoutEffect(() => {
    const container = containerRef.current
    const target = pendingScroll.current
    if (!container || !target) return
    pendingScroll.current = null
    container.scrollLeft = target.left
    container.scrollTop = target.top
  }, [scale])

  /** 切到某一档；`anchor`（双击点）不给时保持视口左上角那点不动 */
  const fit = useCallback(
    (mode: MediaFitMode, anchor?: { x: number; y: number }): void => {
      const container = containerRef.current
      if (!container || !doc) return
      const viewNow = { width: container.clientWidth, height: container.clientHeight }
      applyScale(pptxFitScale(mode, doc.slide, viewNow), mode, anchor ?? { x: 0, y: 0 })
    },
    [doc, applyScale]
  )

  /** 双击落到哪条适应轴：在两条之间来回；「适应窗口」先判它实际顶住的是哪条；1:1 与自由倍率落适应宽度 */
  const doubleClickAxis = (): MediaFitAxis => {
    const current =
      fitMode === 'window' && slide
        ? mediaFitWindowAxis(slide.width, slide.height, view.width, view.height)
        : fitMode
    return current === 'width' ? 'height' : 'width'
  }

  // 容器尺寸一变（拖窗口 / 文件树显隐 / 查找栏与缩略图开合）按新尺寸重算所处的档；自由倍率不动。
  // Tab 切走是 display:none，容器塌成 0：隐藏期间一概不动，等真有尺寸了再说（同 PDF）。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return
      setView({ width: container.clientWidth, height: container.clientHeight })
      if (fitMode) fit(fitMode)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [fitMode, fit])

  /**
   * 跳页，同 PDF.js：页顶对齐视口顶；这页横向没完整露出时（放大后）横向回到页左缘，完整露出则不动。
   */
  const goToPage = useCallback(
    (n: number): void => {
      const container = containerRef.current
      if (!container || !doc || !Number.isFinite(n)) return
      const target = Math.min(doc.presentation.slides.length, Math.max(1, Math.round(n)))
      const viewNow = { width: container.clientWidth, height: container.clientHeight }
      const left = pptxPageLeft(doc.slide, scale, viewNow)
      const right = left + doc.slide.width * scale
      if (left < container.scrollLeft || right > container.scrollLeft + viewNow.width)
        container.scrollLeft = left
      container.scrollTop = (target - 1) * rowH
      setScrollTop(container.scrollTop)
      setPage(target)
    },
    [doc, rowH, scale]
  )
  useEffect(() => {
    goToPageRef.current = goToPage
  }, [goToPage])

  const getPage = useCallback(() => (doc ? { page, pages } : null), [doc, page, pages])

  const onScroll = (): void => {
    const container = containerRef.current
    if (!container || !slide) return
    const top = container.scrollTop
    setScrollTop(top)
    setPage((prev) =>
      pptxCurrentPage({
        scrollTop: top,
        viewHeight: container.clientHeight,
        slideHeight: slide.height * scale,
        rowHeight: rowH,
        pages,
        current: prev
      })
    )
  }

  /** 键盘逐档缩放：按视口中心锚定（同看图 / PDF） */
  const stepZoom = useCallback(
    (steps: 1 | -1): void => {
      const container = containerRef.current
      if (!container) return
      applyScale(pptxStepScale(scaleRef.current, steps), null, {
        x: container.clientWidth / 2,
        y: container.clientHeight / 2
      })
    },
    [applyScale]
  )

  // Cmd/Ctrl+滚轮 / 捏合：按光标缩放（容器贴满 wrap，坐标即容器内坐标）
  const onWheelZoom = useCallback(
    (factor: number, origin: { x: number; y: number }) =>
      applyScale(pptxWheelScale(scaleRef.current, factor), null, origin),
    [applyScale]
  )
  useCtrlWheelZoom(wrapRef, onWheelZoom)

  // —— 查找 ——
  /** 文字索引一份文档建一次（打开查找时），之后每次输入只在索引里搜 */
  const textIndex = useMemo(
    () => (doc && findOpen ? buildTextIndex(doc.presentation) : null),
    [doc, findOpen]
  )
  const matches = useMemo(
    () =>
      textIndex && findQuery
        ? searchText(textIndex, findQuery, { matchCase: caseSensitive, wholeWord })
        : [],
    [textIndex, findQuery, caseSensitive, wholeWord]
  )
  const firstFromPage = matches.findIndex((m) => m.slideIndex + 1 >= findFromPage)
  const current =
    matches.length === 0 ? -1 : (activeMatch ?? (firstFromPage >= 0 ? firstFromPage : 0))
  const currentMatch = current >= 0 ? matches[current] : null

  /** 新一轮查找（打开 / 改查询 / 改选项）：从当前页起找 */
  const restartFind = (): void => {
    setActiveMatch(null)
    setFindFromPage(page)
  }

  const openFind = useCallback(() => {
    setFindOpen(true)
    setFindFocusNonce((n) => n + 1)
    setActiveMatch(null)
    setFindFromPage(page)
  }, [page])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const fitWindow = useCallback(() => fit('window'), [fit])

  usePagedPreviewKeys({
    active,
    rootRef,
    findOpen,
    openFind,
    closeFind,
    fitWindow,
    stepZoom,
    getPage,
    goToPage,
    onPrevFile: onPrev,
    onNextFile: onNext
  })

  const { panning, spaceHeld, onMouseDown } = usePreviewPan({
    active,
    rootRef,
    containerRef,
    enabled: pages > 0,
    passThrough: overTextOrClickable,
    onDoubleClick: (anchor) => fit(doubleClickAxis(), anchor)
  })

  const range = slide ? pptxVisibleRange(scrollTop, view.height, rowH, pages, 1) : null
  const mountedFirst = range?.first ?? -1
  const mountedLast = range?.last ?? -1

  const onSlideRendered = useCallback((index: number, el: HTMLElement | null) => {
    if (el) slideEls.current.set(index, el)
    else slideEls.current.delete(index)
  }, [])

  // 当前命中一变就滚过去：所在页还没挂上先滚到它的页顶，挂上之后由下面的高亮把命中滚到视口正中（同编辑器 / PDF）。
  // 两段都是布局副作用、按声明顺序执行：先记下要滚的命中，再在同一次提交里建高亮区间。
  useLayoutEffect(() => {
    if (revealedFor.current === currentMatch) return
    revealedFor.current = currentMatch
    revealRef.current = currentMatch
    const container = containerRef.current
    if (!currentMatch || !container || slideEls.current.has(currentMatch.slideIndex)) return
    container.scrollTop = currentMatch.slideIndex * rowH
  }, [currentMatch, rowH])

  // 已挂载的页上标出全部命中与当前命中；挂载的页或命中变化时重建（区间随 DOM 走，缩放不必重建）
  useLayoutEffect(() => {
    if (!findOpen || matches.length === 0) return
    const all = sharedHighlight(FIND_HIGHLIGHT, 0)
    const cur = sharedHighlight(FIND_CURRENT_HIGHLIGHT, 1)
    const added: [Highlight, Range][] = []
    matches.forEach((match, i) => {
      const slideEl = slideEls.current.get(match.slideIndex)
      const r = slideEl && matchRange(slideEl, match)
      if (!r) return
      const target = i === current ? cur : all
      target.add(r)
      added.push([target, r])
      const container = containerRef.current
      if (i !== current || revealRef.current !== match || !container) return
      revealRef.current = null
      const rect = r.getBoundingClientRect()
      const box = container.getBoundingClientRect()
      container.scrollTop += rect.top + rect.height / 2 - (box.top + container.clientHeight / 2)
      if (rect.left < box.left || rect.right > box.left + container.clientWidth)
        container.scrollLeft += rect.left + rect.width / 2 - (box.left + container.clientWidth / 2)
    })
    return () => {
      for (const [h, r] of added) h.delete(r)
    }
  }, [findOpen, matches, current, mountedFirst, mountedLast])

  /** 点缩略图跳页后把焦点还给正文，PageUp / PageDown 与 ←/→ 继续滚正文（同关查找栏） */
  const selectThumbnail = (n: number): void => {
    goToPage(n)
    containerRef.current?.focus({ preventScroll: true })
  }

  const thumbHeights = useMemo(
    () =>
      doc
        ? Array<number>(doc.presentation.slides.length).fill(
            Math.round((PAGE_THUMB_W * doc.slide.height) / doc.slide.width)
          )
        : null,
    [doc]
  )

  const countLabel =
    !findOpen || findQuery === ''
      ? null
      : matches.length === 0
        ? '无结果'
        : `${current + 1}/${matches.length}`

  const content = slide ? pptxContentSize(slide, scale, pages, view) : null
  const pageLeft = slide ? pptxPageLeft(slide, scale, view) : 0

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <FilesToolbar
        path={path}
        error={null}
        extra={
          pages > 0 ? (
            <FilesPageControls
              page={page}
              pages={pages}
              fitMode={fitMode}
              onGoToPage={goToPage}
              onFit={fit}
            />
          ) : undefined
        }
        pathExtra={
          pages > 0 ? (
            <FilesThumbnailsToggle on={thumbnails} onToggle={onToggleThumbnails} />
          ) : undefined
        }
        {...toolbar}
      />
      {findOpen && (
        <FindBar
          query={findQuery}
          onQueryChange={(q) => {
            setFindQuery(q)
            restartFind()
          }}
          focusNonce={findFocusNonce}
          countLabel={countLabel}
          caseSensitive={caseSensitive}
          onToggleCaseSensitive={() => {
            setCaseSensitive((v) => !v)
            restartFind()
          }}
          wholeWord={wholeWord}
          onToggleWholeWord={() => {
            setWholeWord((v) => !v)
            restartFind()
          }}
          canNavigate={matches.length > 0}
          onNavigate={(dir) => setActiveMatch((current + dir + matches.length) % matches.length)}
          onClose={closeFind}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {/* 侧栏按文档重挂；加载中先出空壳占位，正文宽度不来回跳；打不开则不出 */}
        {thumbnails && !error && (
          <FilesPageThumbnails
            key={src}
            heights={thumbHeights}
            page={page}
            onSelect={selectThumbnail}
            renderThumb={(n) =>
              doc && (
                <PptxSlideView doc={doc} index={n - 1} scale={PAGE_THUMB_W / doc.slide.width} />
              )
            }
          />
        )}
        <div ref={wrapRef} className="files-pptx relative min-h-0 min-w-0 flex-1 bg-deepest">
          {/* 滚动容器不留内边距：「适应高度」按容器高算，多一层 padding 就整页看不全；页间留白在页下方 */}
          <div
            ref={containerRef}
            tabIndex={0}
            className={cn(
              'absolute inset-0 cursor-grab overflow-auto outline-none',
              spaceHeld && 'pan-mode select-none'
            )}
            onMouseDown={onMouseDown}
            onScroll={onScroll}
          >
            {doc && content && range && (
              <div className="relative" style={{ width: content.width, height: content.height }}>
                {Array.from(
                  { length: range.last - range.first + 1 },
                  (_, k) => range.first + k
                ).map((i) => (
                  <div key={i} className="absolute" style={{ top: i * rowH, left: pageLeft }}>
                    <PptxSlideView
                      doc={doc}
                      index={i}
                      scale={scale}
                      className="files-pptx-slide"
                      onRendered={onSlideRendered}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          {panning && <div className="fixed inset-0 z-50 cursor-grabbing" />}
          {error && <FilesPreviewError title="无法预览此 PPT" message={error} path={path} />}
        </div>
      </div>
    </div>
  )
}
