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
// 用 legacy 构建：默认构建依赖比当前 Electron 的 Chromium 更新的 JS 特性（如 Map#getOrInsertComputed），legacy 自带垫片。
import { useCallback, useEffect, useRef, useState } from 'react'
import { PanelLeft } from 'lucide-react'
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
import { useApp } from '@renderer/store'
import { editableTarget, overlayOpen } from '@renderer/lib/files-key-guards'
import { cn } from '@renderer/lib/utils'
import {
  mediaFitWindowAxis,
  zoomFromWheel,
  type MediaFitAxis,
  type MediaFitMode
} from '@renderer/lib/files-media-zoom'
import { PdfThumbnailRenderer } from '@renderer/lib/files-pdf-thumbnails'
import { MEDIA_SETTLE_MS, MediaFitButtons } from './FilesMediaPreview'
import { toSysPath } from '@renderer/lib/files-paths'
import { FilesPdfThumbnails } from './FilesPdfThumbnails'
import {
  FilesToolbar,
  TOOLBAR_BTN,
  TOOLBAR_SEPARATOR,
  type FilesToolbarProps
} from './FilesToolbar'
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
  /** 页码输入框正在编辑的草稿；null = 显示当前页 */
  const [pageDraft, setPageDraft] = useState<string | null>(null)
  /** 当前所处的档；null = 滚轮缩出的自由倍率，四颗钮都不亮 */
  const [fitMode, setFitMode] = useState<MediaFitMode | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusNonce, setFindFocusNonce] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [findResult, setFindResult] = useState<FindResult | null>(null)
  const [panning, setPanning] = useState(false)
  /** 空格按住 = 抓手修饰键；ref 给事件处理读，state 给光标样式 */
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const dragCleanup = useRef<(() => void) | null>(null)

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

  // Cmd/Ctrl+F 打开查找（焦点在本预览内或无焦点时）；焦点在 viewer 上按 Esc 关闭
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root) return
      const target = e.target
      const inside = target instanceof Node && root.contains(target)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (!inside && (target !== document.body || editableTarget(target))) return
        const app = useApp.getState()
        if (overlayOpen() || app.contentSearchOpen || app.dialog.open) return
        e.preventDefault()
        e.stopPropagation()
        openFind()
        return
      }
      // Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 逐档缩放。这三个键已从应用菜单的视图块里摘掉
      //（Electron 的 viewMenu 自带整页缩放，菜单加速键优先级更高，留着就压住这里）。
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        // Cmd+= 与 Cmd+Shift+= 都算放大（后者就是键盘上的 Cmd++）；回基准视图则不许带 Shift
        const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd'
        const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract'
        const reset = e.code === 'Digit0' && !e.shiftKey
        if (zoomIn || zoomOut || reset) {
          if (!inside && (target !== document.body || editableTarget(target))) return
          const app = useApp.getState()
          if (overlayOpen() || app.contentSearchOpen || app.dialog.open) return
          e.preventDefault()
          e.stopPropagation()
          if (reset) fit('window')
          else stepZoom(zoomIn ? 1 : -1)
          return
        }
      }
      // ←/→ 切上一个 / 下一个媒体文件（↑/↓ 留给翻页，所以 PDF 只用左右）；守卫同下
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        (onPrev || onNext)
      ) {
        if (editableTarget(target) || overlayOpen()) return
        const app = useApp.getState()
        if (app.contentSearchOpen || app.dialog.open) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowLeft') onPrev?.()
        else onNext?.()
        return
      }
      // ↑/↓ 始终上一页 / 下一页（不看档位；正文与缩略图侧栏内都如此），同看图的方向键切图：
      // 不抢输入框与弹层，不要求焦点在预览内。已在第一页 / 最后一页时再按，就切上一个 / 下一个媒体
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (editableTarget(target) || overlayOpen()) return
        const app = useApp.getState()
        if (app.contentSearchOpen || app.dialog.open) return
        const viewer = viewerRef.current
        if (!viewer?.pdfDocument) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowUp') {
          if (viewer.currentPageNumber <= 1) onPrev?.()
          else viewer.previousPage()
        } else if (viewer.currentPageNumber >= viewer.pagesCount) onNext?.()
        else viewer.nextPage()
        return
      }
      if (e.key === 'Escape' && findOpen && inside && !editableTarget(target)) {
        e.preventDefault()
        closeFind()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, findOpen, openFind, closeFind, fit, stepZoom, onPrev, onNext])

  useEffect(() => () => dragCleanup.current?.(), [])

  // 空格按住 = 抓手修饰键（焦点在本预览内且不在输入框）；松开或窗口失焦即恢复
  useEffect(() => {
    if (!active) return
    const setSpace = (held: boolean): void => {
      if (spaceRef.current === held) return
      spaceRef.current = held
      setSpaceHeld(held)
    }
    const onDown = (e: KeyboardEvent): void => {
      if (e.key !== ' ') return
      const root = rootRef.current
      const target = e.target
      if (!root || !(target instanceof Node) || !root.contains(target) || editableTarget(target))
        return
      // 连按住的重复事件也要拦，否则原生「空格翻页」会抢走
      e.preventDefault()
      if (!e.repeat) setSpace(true)
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') setSpace(false)
    }
    const onBlur = (): void => setSpace(false)
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      setSpace(false)
    }
  }, [active])

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
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      const viewer = viewerRef.current
      if (!viewer?.pdfDocument) return
      const rect = wrap.getBoundingClientRect()
      viewer.updateScale({
        scaleFactor: zoomFromWheel(1, e.deltaY, e),
        origin: [e.clientX - rect.left, e.clientY - rect.top],
        drawingDelay: MEDIA_SETTLE_MS
      })
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  /** 拖拽平移：文字 / 注解控件上让给选字与点击，其余（或按住空格）抓着滚动容器走，同看图。 */
  const startPan = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const container = containerRef.current
    if (!container || pages <= 0) return
    if (!spaceRef.current && overTextOrAnnotation(e.target)) return
    // 空白处双击换档，从 mousedown 的点击计数判定而非接 dblclick：拖拽期间盖着的全屏遮罩会接走
    // mouseup，click / dblclick 的 target 退化成两者的共同祖先，永远落不到这里。
    // 文字 / 注解上已在前一行让路，原生双击选词不受影响。
    if (e.detail === 2) {
      const rect = container.getBoundingClientRect()
      fit(doubleClickAxis(), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      return
    }
    e.preventDefault()
    container.focus({ preventScroll: true })
    const origin = {
      x: e.clientX,
      y: e.clientY,
      left: container.scrollLeft,
      top: container.scrollTop
    }
    setPanning(true)
    const onMove = (ev: MouseEvent): void => {
      container.scrollLeft = origin.left - (ev.clientX - origin.x)
      container.scrollTop = origin.top - (ev.clientY - origin.y)
    }
    const onUp = (): void => {
      dragCleanup.current = null
      setPanning(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    dragCleanup.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const goToPage = (n: number): void => {
    const viewer = viewerRef.current
    if (!viewer || !Number.isFinite(n) || pages <= 0) return
    viewer.currentPageNumber = Math.min(pages, Math.max(1, Math.round(n)))
  }

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

  const controls = pages > 0 && (
    <>
      {/* 页码这组自己撑出与钮一致的左右留白（钮是 size-7 装 size-4 图标，等效 px-1.5），
          否则它紧贴面包屑与竖线，与右侧钮组的节奏对不上 */}
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <input
          value={pageDraft ?? String(page)}
          onChange={(e) => setPageDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setPageDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              goToPage(Number(pageDraft))
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.blur()
            }
          }}
          inputMode="numeric"
          title="页码"
          className="h-6 w-9 shrink-0 rounded border border-[var(--border-input)] bg-transparent text-center text-[12px] text-foreground tabular-nums transition-colors outline-none focus:bg-[var(--bg-row-hover)]"
        />
        <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">/ {pages}</span>
      </div>
      <div className={TOOLBAR_SEPARATOR} role="separator" />
      <MediaFitButtons active={fitMode} onFit={fit} />
    </>
  )

  // 缩略图侧栏开关领在面包屑之前（侧栏在正文左侧，钮也靠左，位置不随路径长短漂移）；开着时点亮，激活态同四档钮 / 查找栏方形开关
  const thumbsToggle = pages > 0 && (
    <button
      type="button"
      title="缩略图"
      className={cn(
        TOOLBAR_BTN,
        thumbnails &&
          'bg-[var(--selection-row)] text-foreground hover:bg-[var(--selection-row)] hover:text-foreground'
      )}
      onClick={onToggleThumbnails}
    >
      <PanelLeft className="size-4" />
    </button>
  )

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <FilesToolbar
        path={path}
        error={null}
        extra={controls || undefined}
        pathExtra={thumbsToggle || undefined}
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
          <FilesPdfThumbnails key={src} renderer={thumbs} page={page} onSelect={selectThumbnail} />
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
            onMouseDown={startPan}
          >
            <div className="pdfViewer" />
          </div>
          {panning && <div className="fixed inset-0 z-50 cursor-grabbing" />}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-deepest px-6 text-sm text-muted-foreground">
              <p>无法预览此 PDF</p>
              <p className="text-xs">{error}</p>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[color:var(--fg-primary)] transition-colors hover:bg-[var(--bg-button-hover)]"
                onClick={() => void window.api.openPath(toSysPath(path))}
              >
                在其他应用中打开
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
