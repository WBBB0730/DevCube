// Files Tab · PDF 预览：PDF.js（pdfjs-dist）官方 viewer 组件负责连续滚动、只渲染可见页、缩放重绘、
// 文字层（选中复制）与查找；工具栏、查找栏、快捷键、主题是 DevCube 的壳（ADR-0030）。
// 文件经 dc-media 一次取回交给 PDF.js；字体映射表 / 标准字体 / wasm 也经 dc-media 从应用自带资源读取
//（PDF.js 只对 http(s) 用 fetch、其余走 XHR，这里自备 fetch 取数工厂，走协议明确支持的 fetch）。
// Cmd/Ctrl+滚轮与触控板捏合按光标缩放（手感常量复用看图）；普通滚轮原生滚动；Cmd+F 查找。
// 拖拽：按在文字上是选字，按在空白处（页边 / 图片 / 页间）是抓手，按住空格则处处抓手（Preview / 设计工具惯例）。
// 工具栏四档：1:1（纸张实际尺寸）/ 适应高度 / 适应宽度 / 适应窗口，打开即适应窗口；
// Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 按视口中心逐档缩放（同看图；这三个键已从应用菜单的视图块摘掉，见 ADR-0019）。
// 空白处双击在「适应宽度 / 适应高度」两档间切换（文字上双击仍是选词）；容器尺寸一变，预设档按新尺寸重算。
// 正文左侧缩略图侧栏（FilesPdfThumbnails）：点格跳页、翻页跟随点亮；面包屑前一颗开关钮（开着点亮），状态归 FilesPane 会话内保持；
// 小图的排队 / 缓存归 PdfThumbnailRenderer，随文档建、随文档销毁，侧栏开合不丢缓存。
// ↑/↓ 始终上一页 / 下一页（不看档位，正文与侧栏内都如此，同看图的方向键切图）。
// 外链由库标 target=_blank，交主进程开窗守卫转系统浏览器（web-contents-guard）；内链（目录跳转）库自处理。
// 库样式表在 main.css 顶部以级联层引入（.files-pdf 覆盖也在那里）。
// 键盘、抓手、滚轮缩放、页码与四档、缩略图侧栏是与 PPT 预览共用的外壳（lib/files-paged-preview、FilesPagedControls、FilesPageThumbnails）。
// 用 legacy 构建：默认构建依赖比当前 Electron 的 Chromium 更新的 JS 特性（如 Map#getOrInsertComputed），legacy 自带垫片。
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  EventBus,
  FindState,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer
} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { buildFilesAssetUrl, FILES_ASSET_PDFJS } from '@shared/files'
import { cn } from '@renderer/lib/utils'
import {
  mediaFitWindowAxis,
  type MediaFitAxis,
  type MediaFitMode
} from '@renderer/lib/files-media-zoom'
import { PdfThumbnailRenderer } from '@renderer/lib/files-pdf-thumbnails'
import type { ThumbnailWindow } from '@renderer/lib/files-page-thumbnails'
import {
  useCtrlWheelZoom,
  usePagedPreviewKeys,
  usePreviewPan
} from '@renderer/lib/files-paged-preview'
import { MEDIA_SETTLE_MS } from './FilesMediaPreview'
import { FilesPageControls, FilesPreviewError, FilesThumbnailsToggle } from './FilesPagedControls'
import { FilesPageThumbnails } from './FilesPageThumbnails'
import { FilesToolbar, type FilesToolbarProps } from './FilesToolbar'
import { FindBar } from './FindBar'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/**
 * 单张位图解码后的像素上限：超限的图按 2 的幂缩小（JPEG 直接按目标尺寸解码，省时也省内存）。
 * 8 MP 够 2 倍屏适配宽度全幅清晰；放大两倍以上的大照片会略软，这是有意的取舍（PRD）。
 * 2048×2048 以内的图 PDF.js 一律不碰。解码尺寸在首次渲染时定死，缩放不会重解。
 */
const PDF_IMAGE_MAX_PIXELS = 8 * 1024 * 1024

const ASSET_URLS = {
  cMapUrl: buildFilesAssetUrl(FILES_ASSET_PDFJS, 'cmaps/'),
  standardFontDataUrl: buildFilesAssetUrl(FILES_ASSET_PDFJS, 'standard_fonts/'),
  wasmUrl: buildFilesAssetUrl(FILES_ASSET_PDFJS, 'wasm/')
}

type AssetKind = keyof typeof ASSET_URLS

/** PDF.js 在主线程取字体映射表 / 标准字体 / wasm 的工厂：接口同其 DOMBinaryDataFactory，但用 fetch。 */
class MediaBinaryDataFactory {
  #base: Record<AssetKind, string | null>

  constructor(opts: Partial<Record<AssetKind, string | null>>) {
    this.#base = {
      cMapUrl: opts.cMapUrl ?? null,
      standardFontDataUrl: opts.standardFontDataUrl ?? null,
      wasmUrl: opts.wasmUrl ?? null
    }
  }

  async fetch({ kind, filename }: { kind: AssetKind; filename: string }): Promise<Uint8Array> {
    const base = this.#base[kind]
    if (!base) throw new Error(`缺少 ${kind}`)
    const res = await fetch(`${base}${filename}`)
    if (!res.ok) throw new Error(`无法加载 ${kind}：${filename}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

/**
 * 查找命中改为每次滚到视口正中（同编辑器查找；库默认贴顶留 50px）。前三行守卫照抄库实现，只换对齐方式。
 * Chromium 页内查找 / PDF 查看器是「已在可视区内不动、否则居中」，手感不合适可在此加可见性判断。
 */
class CenteringFindController extends PDFFindController {
  override scrollMatchIntoView({
    element,
    pageIndex,
    matchIndex
  }: {
    element: HTMLElement
    pageIndex: number
    matchIndex: number
  }): void {
    if (!this._scrollMatches || !element) return
    if (matchIndex === -1 || matchIndex !== this._selected?.matchIdx) return
    if (pageIndex === -1 || pageIndex !== this._selected?.pageIdx) return
    this._scrollMatches = false
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
}

type FindResult = { state: number; current: number; total: number }

/** 四档 ↔ PDF.js 的预设缩放值。`actual` 是纸张实际尺寸（1 pt = 1/72 英寸），与窗口无关。 */
const PDF_SCALE_VALUE: Record<MediaFitMode, string> = {
  actual: 'page-actual',
  width: 'page-width',
  height: 'page-height',
  window: 'page-fit'
}

const PDF_FIT_MODE: Record<string, MediaFitMode> = {
  'page-actual': 'actual',
  'page-width': 'width',
  'page-height': 'height',
  'page-fit': 'window'
}

/** 文字层与注解控件上的鼠标动作让给选字与点击（抓手与双击都照此让路）。 */
function overTextOrAnnotation(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '.textLayer span, .textLayer br, .annotationLayer, a, button, input, select, textarea'
    ) !== null
  )
}

const noSubscribe = (): (() => void) => () => {}
const zero = (): number => 0

/** 缩略图侧栏的 PDF 一侧：跟着渲染器（尺寸取齐 / 画好一张）重渲染，格子显示缓存的小图 */
function PdfThumbnails({
  renderer,
  page,
  onSelect
}: {
  /** 当前文档的渲染器；null = 文档尚在加载，只出侧栏空壳 */
  renderer: PdfThumbnailRenderer | null
  page: number
  onSelect: (page: number) => void
}): React.JSX.Element {
  useSyncExternalStore(
    renderer ? renderer.subscribe : noSubscribe,
    renderer ? renderer.getVersion : zero
  )
  const onWindowChange = useCallback(
    (win: ThumbnailWindow | null) => renderer?.setWindow(win),
    [renderer]
  )
  return (
    <FilesPageThumbnails
      heights={renderer?.heights ?? null}
      page={page}
      onSelect={onSelect}
      onWindowChange={onWindowChange}
      renderThumb={(n) => {
        const url = renderer?.url(n)
        return url && <img src={url} alt="" draggable={false} className="block size-full" />
      }}
    />
  )
}

export function FilesPdfPreview({
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
  /** Files Tab 可见时才响应 Cmd+F */
  active: boolean
  /** ←/→ 切上一个 / 下一个媒体文件（↑/↓ 归翻页）；由 FilesPane 按树内可见序给 */
  onPrev?: () => void
  onNext?: () => void
  /** 缩略图侧栏可见性（会话内保持，归 FilesPane） */
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
  const viewerRef = useRef<PDFViewer | null>(null)
  const linkServiceRef = useRef<PDFLinkService | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const [docInfo, setDocInfo] = useState<{
    src: string
    doc: PDFDocumentProxy
    thumbs: PdfThumbnailRenderer
  } | null>(null)
  const [loadError, setLoadError] = useState<{ src: string; message: string } | null>(null)
  const [page, setPage] = useState(1)
  /** 当前所处的档；null = 滚轮缩出的自由倍率，四颗钮都不亮 */
  const [fitMode, setFitMode] = useState<MediaFitMode | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [findResult, setFindResult] = useState<FindResult | null>(null)

  const doc = docInfo?.src === src ? docInfo.doc : null
  const thumbs = docInfo?.src === src ? docInfo.thumbs : null
  const pages = doc?.numPages ?? 0
  const error = loadError?.src === src ? loadError.message : null

  // viewer 组件只建一次；换文件只换文档
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const eventBus = new EventBus()
    // 外链 target=_blank：走 Chromium 开窗请求 → 主进程守卫 → 系统浏览器，绝不在本窗导航
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK })
    const findController = new CenteringFindController({
      eventBus,
      linkService,
      updateMatchesCountOnProgress: true
    })
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1,
      annotationMode: AnnotationMode.ENABLE,
      removePageBorders: true
    })
    linkService.setViewer(viewer)
    // 打开即整页显示得下（同看图默认）
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = PDF_SCALE_VALUE.window
    })
    eventBus.on('pagechanging', (e: { pageNumber: number }) => setPage(e.pageNumber))
    // 预设缩放才带 presetValue；滚轮缩出来的数值倍率给 undefined，四颗钮随之全灭
    eventBus.on('scalechanging', (e: { presetValue?: string }) =>
      setFitMode(e.presetValue ? (PDF_FIT_MODE[e.presetValue] ?? null) : null)
    )
    eventBus.on(
      'updatefindcontrolstate',
      (e: { state: number; matchesCount: { current: number; total: number } }) =>
        setFindResult({
          state: e.state,
          current: e.matchesCount.current,
          total: e.matchesCount.total
        })
    )
    eventBus.on(
      'updatefindmatchescount',
      (e: { matchesCount: { current: number; total: number } }) =>
        setFindResult((prev) => ({
          state: prev?.state ?? FindState.FOUND,
          current: e.matchesCount.current,
          total: e.matchesCount.total
        }))
    )
    viewerRef.current = viewer
    linkServiceRef.current = linkService
    busRef.current = eventBus
    return () => {
      viewerRef.current = null
      linkServiceRef.current = null
      busRef.current = null
    }
  }, [])

  // 取文件、解析、挂到 viewer；换文件或卸载时销毁旧文档
  useEffect(() => {
    const viewer = viewerRef.current
    const linkService = linkServiceRef.current
    const bus = busRef.current
    if (!viewer || !linkService || !bus) return
    let dead = false
    let task: PDFDocumentLoadingTask | null = null
    let doc: PDFDocumentProxy | null = null
    let thumbs: PdfThumbnailRenderer | null = null
    void (async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`读取失败（${res.status}）`)
        const data = new Uint8Array(await res.arrayBuffer())
        if (dead) return
        task = getDocument({
          data,
          ...ASSET_URLS,
          cMapPacked: true,
          useWorkerFetch: false,
          BinaryDataFactory: MediaBinaryDataFactory,
          // 画布走 GPU（PDF.js 自家 viewer 的默认值；库层默认关是保守起见），整页大图类 PDF 受益最大
          enableHWA: true,
          // 一页里嵌几张相机原片时（实测一页 1.78 亿像素、700 MB）不至于拖垮整份文档
          canvasMaxAreaInBytes: PDF_IMAGE_MAX_PIXELS * 4
        })
        doc = await task.promise
        if (dead) return
        viewer.setDocument(doc)
        linkService.setDocument(doc, null)
        // 缩略图渲染器随文档建；等正文首页画完（onePageRendered）才开工
        thumbs = new PdfThumbnailRenderer(doc, bus, viewer.onePageRendered)
        setDocInfo({ src, doc, thumbs })
        setPage(1)
        containerRef.current?.focus({ preventScroll: true })
      } catch (e) {
        if (!dead) setLoadError({ src, message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      dead = true
      thumbs?.destroy()
      viewer.setDocument(null as unknown as PDFDocumentProxy)
      linkService.setDocument(null, null)
      void task?.destroy()
      doc = null
    }
  }, [src])

  const openFind = useCallback(() => {
    setFindOpen(true)
    setFindFocusNonce((n) => n + 1)
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    busRef.current?.dispatch('findbarclose', { source: null })
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const dispatchFind = useCallback(
    (type: '' | 'again', findPrevious = false) => {
      busRef.current?.dispatch('find', {
        source: null,
        type,
        query: findQuery,
        caseSensitive,
        entireWord: wholeWord,
        highlightAll: true,
        findPrevious,
        matchDiacritics: false
      })
    },
    [findQuery, caseSensitive, wholeWord]
  )

  /**
   * 切到某一档。
   * 给了 `anchor`（双击点，容器内坐标）就按倍率变化改滚动位置，让那一点下的内容留在原处
   * ——库的预设缩放只保当前页可见，不认锚点。
   */
  const fit = useCallback((mode: MediaFitMode, anchor?: { x: number; y: number }): void => {
    const viewer = viewerRef.current
    const container = containerRef.current
    if (!viewer || !container) return
    const before = viewer.currentScale
    const docX = container.scrollLeft + (anchor?.x ?? 0)
    const docY = container.scrollTop + (anchor?.y ?? 0)
    viewer.currentScaleValue = PDF_SCALE_VALUE[mode]
    if (!anchor || before <= 0) return
    const k = viewer.currentScale / before
    container.scrollLeft = docX * k - anchor.x
    container.scrollTop = docY * k - anchor.y
  }, [])

  /**
   * 双击落到哪条适应轴：在两条之间来回。「适应窗口」（page-fit）是库在两条轴里取小的那个，
   * 也就顶着其中一条——比一下当前页与容器的宽高比就知道是哪条，再切到另一条
   *（库的 padding 已被 `removePageBorders` 归零，比值与库内部算的一致）。
   * 1:1 与自由倍率不在轴上，落适应宽度。
   */
  const doubleClickAxis = useCallback((): MediaFitAxis => {
    const viewer = viewerRef.current
    const container = containerRef.current
    const preset = viewer?.currentScaleValue
    const mode = preset ? (PDF_FIT_MODE[preset] ?? null) : null
    const page =
      mode === 'window' && viewer && container
        ? (viewer.getPageView(viewer.currentPageNumber - 1) as
            { width: number; height: number } | undefined)
        : undefined
    const current =
      page && container
        ? mediaFitWindowAxis(page.width, page.height, container.clientWidth, container.clientHeight)
        : mode
    return current === 'width' ? 'height' : 'width'
  }, [])

  /**
   * 键盘逐档缩放：按视口中心锚定（同看图）。库不带 origin 时会把视口左上角那点放回原处，
   * 内容随放大往右下漂出视野。origin 以容器的 offsetParent 为基准，容器贴满 wrap，故等于容器内坐标。
   */
  const stepZoom = useCallback((steps: 1 | -1): void => {
    const viewer = viewerRef.current
    const container = containerRef.current
    if (!viewer?.pdfDocument || !container) return
    viewer.updateScale({
      steps,
      origin: [container.clientWidth / 2, container.clientHeight / 2],
      drawingDelay: MEDIA_SETTLE_MS
    })
  }, [])

  // 查询 / 选项变化即重新查找（PDF.js 自带防抖）
  useEffect(() => {
    if (!findOpen) return
    dispatchFind('')
  }, [findOpen, dispatchFind])

  const getPage = useCallback(() => {
    const viewer = viewerRef.current
    return viewer?.pdfDocument ? { page: viewer.currentPageNumber, pages: viewer.pagesCount } : null
  }, [])

  const goToPage = useCallback((n: number): void => {
    const viewer = viewerRef.current
    if (!viewer?.pdfDocument || !Number.isFinite(n)) return
    viewer.currentPageNumber = Math.min(viewer.pagesCount, Math.max(1, Math.round(n)))
  }, [])

  const fitWindow = useCallback(() => fit('window'), [fit])

  usePagedPreviewKeys({
    active,
    rootRef,
    findOpen,
    openFind,
    closeFind,
    resetZoom: fitWindow,
    stepZoom,
    getPage,
    goToPage,
    onPrevFile: onPrev,
    onNextFile: onNext
  })

  // 文字层与注解控件上让给选字与点击；空白处双击在两条轴之间切换，以双击点为锚点
  const { panning, spaceHeld, onMouseDown } = usePreviewPan({
    active,
    rootRef,
    containerRef,
    enabled: pages > 0,
    passThrough: overTextOrAnnotation,
    onDoubleClick: (anchor) => fit(doubleClickAxis(), anchor)
  })

  // 容器尺寸一变（拖窗口 / 文件树显隐 / 查找栏开合）就按新尺寸重算预设缩放：库自带的
  // ResizeObserver 只更新内部缓存，重算缩放历来是官方 viewer 外壳的活，这里等价补上。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      const viewer = viewerRef.current
      if (!viewer?.pdfDocument) return
      // Tab 切走是 display:none，容器塌成 0：按 0 重算会把页面缩到 0 宽高，之后连预设倍率都成了
      // 0/0，切回来就落在一个无意义的倍率上。隐藏期间一概不动，等真有尺寸了再说。
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return
      const value = viewer.currentScaleValue
      // 预设值才跟随（page-actual 重设也无妨，它不看容器）；滚轮缩出来的数值倍率保持不动
      if (!value) viewer.currentScaleValue = PDF_SCALE_VALUE.window
      else if (Number.isNaN(Number(value))) viewer.currentScaleValue = value
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // Cmd/Ctrl+滚轮 / 捏合：按光标缩放，手势中只做 CSS 缩放、停手后重绘（drawingDelay）
  const onWheelZoom = useCallback((factor: number, origin: { x: number; y: number }) => {
    const viewer = viewerRef.current
    if (!viewer?.pdfDocument) return
    viewer.updateScale({
      scaleFactor: factor,
      origin: [origin.x, origin.y],
      drawingDelay: MEDIA_SETTLE_MS
    })
  }, [])
  useCtrlWheelZoom(wrapRef, onWheelZoom)

  /** 点缩略图跳页后把焦点还给正文，PageUp / PageDown 与 ←/→ 继续滚正文（同关查找栏） */
  const selectThumbnail = (n: number): void => {
    goToPage(n)
    containerRef.current?.focus({ preventScroll: true })
  }

  const countLabel =
    !findOpen || findQuery === '' || !findResult
      ? null
      : findResult.state === FindState.NOT_FOUND
        ? '无结果'
        : findResult.total > 0
          ? `${findResult.current}/${findResult.total}`
          : null

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
          onQueryChange={setFindQuery}
          focusNonce={findFocusNonce}
          countLabel={countLabel}
          caseSensitive={caseSensitive}
          onToggleCaseSensitive={() => setCaseSensitive((v) => !v)}
          wholeWord={wholeWord}
          onToggleWholeWord={() => setWholeWord((v) => !v)}
          canNavigate={(findResult?.total ?? 0) > 0}
          onNavigate={(dir) => dispatchFind('again', dir < 0)}
          onClose={closeFind}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {/* 侧栏按文档重挂（尺寸一次算好）；加载中先出空壳占位，正文宽度不来回跳；打不开则不出 */}
        {thumbnails && !error && (
          <PdfThumbnails key={src} renderer={thumbs} page={page} onSelect={selectThumbnail} />
        )}
        <div ref={wrapRef} className="files-pdf relative min-h-0 min-w-0 flex-1 bg-deepest">
          {/* 滚动容器不留内边距：库拿容器高度算 page-height，多一层 padding 就会让「适应高度」溢出、
              整页看不全；页间留白由库的 .page margin 负责（removePageBorders 下是 0 auto 10px） */}
          <div
            ref={containerRef}
            tabIndex={0}
            className={cn(
              'absolute inset-0 cursor-grab overflow-auto outline-none',
              spaceHeld && 'pan-mode select-none'
            )}
            onMouseDown={onMouseDown}
          >
            <div className="pdfViewer" />
          </div>
          {panning && <div className="fixed inset-0 z-50 cursor-grabbing" />}
          {error && <FilesPreviewError title="无法预览此 PDF" message={error} path={path} />}
        </div>
      </div>
    </div>
  )
}
