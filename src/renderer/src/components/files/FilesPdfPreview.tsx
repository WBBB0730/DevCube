// Files Tab · PDF 预览：PDF.js（pdfjs-dist）官方 viewer 组件负责连续滚动、只渲染可见页、缩放重绘、
// 文字层（选中复制）与查找；工具栏、查找栏、快捷键、主题是 DevCube 的壳（ADR-0030）。
// 文件经 dc-media 一次取回交给 PDF.js；字体映射表 / 标准字体 / wasm 也经 dc-media 从应用自带资源读取
//（PDF.js 只对 http(s) 用 fetch、其余走 XHR，这里自备 fetch 取数工厂，走协议明确支持的 fetch）。
// Cmd/Ctrl+滚轮与触控板捏合按光标缩放（手感常量复用看图）；普通滚轮原生滚动；Cmd+F 查找。
// 拖拽：按在文字上是选字，按在空白处（页边 / 图片 / 页间）是抓手，按住空格则处处抓手（Preview / 设计工具惯例）。
// 外链由库标 target=_blank，交主进程开窗守卫转系统浏览器（web-contents-guard）；内链（目录跳转）库自处理。
// 库样式表在 main.css 顶部以级联层引入（.files-pdf 覆盖也在那里）。
// 用 legacy 构建：默认构建依赖比当前 Electron 的 Chromium 更新的 JS 特性（如 Map#getOrInsertComputed），legacy 自带垫片。
import { useCallback, useEffect, useRef, useState } from 'react'
import { MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-react'
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
import { cn } from '@renderer/lib/utils'
import { zoomFromWheel } from '@renderer/lib/files-media-zoom'
import { MEDIA_SETTLE_MS } from './FilesMediaPreview'
import { toSysPath } from '@renderer/lib/files-paths'
import { FilesToolbar, TOOLBAR_BTN, type FilesToolbarProps } from './FilesToolbar'
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

function overlayOpen(): boolean {
  return [...document.querySelectorAll('.fixed.inset-0.z-50.flex.items-center')].some(
    (el) => el.getClientRects().length > 0
  )
}

function editableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export function FilesPdfPreview({
  src,
  path,
  active,
  toolbar
}: {
  src: string
  path: string
  /** Files Tab 可见时才响应 Cmd+F */
  active: boolean
  toolbar: Omit<
    FilesToolbarProps,
    'path' | 'error' | 'extra' | 'sourcePreview' | 'onToggleSourcePreview'
  >
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const linkServiceRef = useRef<PDFLinkService | null>(null)
  const busRef = useRef<EventBus | null>(null)
  const [docInfo, setDocInfo] = useState<{ src: string; pages: number } | null>(null)
  const [loadError, setLoadError] = useState<{ src: string; message: string } | null>(null)
  const [page, setPage] = useState(1)
  /** 页码输入框正在编辑的草稿；null = 显示当前页 */
  const [pageDraft, setPageDraft] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
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

  const pages = docInfo?.src === src ? docInfo.pages : 0
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
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width'
    })
    eventBus.on('pagechanging', (e: { pageNumber: number }) => setPage(e.pageNumber))
    eventBus.on('scalechanging', (e: { scale: number }) => setScale(e.scale))
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
    if (!viewer || !linkService) return
    let dead = false
    let task: PDFDocumentLoadingTask | null = null
    let doc: PDFDocumentProxy | null = null
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
        setDocInfo({ src, pages: doc.numPages })
        setPage(1)
        containerRef.current?.focus({ preventScroll: true })
      } catch (e) {
        if (!dead) setLoadError({ src, message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      dead = true
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
      if (e.key === 'Escape' && findOpen && inside && !editableTarget(target)) {
        e.preventDefault()
        closeFind()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, findOpen, openFind, closeFind])

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
    const target = e.target
    if (
      !spaceRef.current &&
      target instanceof Element &&
      target.closest(
        '.textLayer span, .textLayer br, .annotationLayer, a, button, input, select, textarea'
      )
    ) {
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
        className="h-6 w-9 shrink-0 rounded border border-[var(--border-input)] bg-transparent text-center text-[12px] text-foreground tabular-nums outline-none focus:border-[var(--fg-primary)]"
      />
      <span className="shrink-0 pr-1 text-[12px] text-muted-foreground tabular-nums">
        / {pages}
      </span>
      <button
        type="button"
        title="缩小"
        className={TOOLBAR_BTN}
        onClick={() => viewerRef.current?.decreaseScale({ drawingDelay: MEDIA_SETTLE_MS })}
      >
        <ZoomOut className="size-4" />
      </button>
      <span className="w-10 shrink-0 text-center text-[12px] text-muted-foreground tabular-nums">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        title="放大"
        className={TOOLBAR_BTN}
        onClick={() => viewerRef.current?.increaseScale({ drawingDelay: MEDIA_SETTLE_MS })}
      >
        <ZoomIn className="size-4" />
      </button>
      <button
        type="button"
        title="适配宽度"
        className={TOOLBAR_BTN}
        onClick={() => {
          const viewer = viewerRef.current
          if (viewer) viewer.currentScaleValue = 'page-width'
        }}
      >
        <MoveHorizontal className="size-4" />
      </button>
    </>
  )

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <FilesToolbar path={path} error={null} extra={controls || undefined} {...toolbar} />
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
      <div ref={wrapRef} className="files-pdf relative min-h-0 flex-1 bg-deepest">
        <div
          ref={containerRef}
          tabIndex={0}
          className={cn(
            'absolute inset-0 cursor-grab overflow-auto py-3 outline-none',
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
  )
}
