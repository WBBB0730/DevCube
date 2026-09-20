// Files Tab · 位图 / SVG 预览：浏览器原生 `<img>` 流水线（ADR-0029）。
// 手势期间只改 transform（合成器，不重排、不重解码）；缩放停手后把倍率烙进 width/height，
// Chromium 按新尺寸重新栅格化，任何倍率都清晰（PhotoSwipe / macOS 预览同法）。
// 超大位图（tiled）先显示主进程出的预览图，金字塔就绪后在其上叠 OpenSeadragon 瓦片层（预览图留在底下垫着），同一相机驱动。
// 换图先屏外解码再换 src、`<img>` 同步解码，切图与提交尺寸都不会画出空白帧。
// SVG 走 data URL（CSP 已放行 data:），不当 inline XML，脚本不执行。
// Cmd/Ctrl+滚轮按光标缩放（触控板捏合是 Chromium 合成的 ctrl+wheel）；滚轮或按住拖拽平移；
// 方向键切同一目录上一张 / 下一张；工具栏四档（1:1 / 适应高度 / 适应宽度 / 适应窗口）、双击在两条轴间切、
// Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 逐档缩放（这三个键已从应用菜单的视图块摘掉，见 ADR-0019）；
// 打开时装得下的图落 1:1、装不下的落适应窗口。
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { GalleryHorizontal, GalleryVertical, Scan } from 'lucide-react'
import { useApp } from '@renderer/store'
import { cn } from '@renderer/lib/utils'
import type { FilesImagePyramid } from '@shared/files-image-tiles'
import {
  centerMediaCamera,
  clampMediaCamera,
  mediaActualZoom,
  mediaDrawScale,
  mediaFitsViewport,
  mediaFitZoom,
  MEDIA_ZOOM_STEP,
  panMediaCamera,
  zoomFromWheel,
  zoomMediaCameraAt,
  type MediaCamera,
  type MediaFitMode
} from '@renderer/lib/files-media-zoom'
import { FilesMediaTiles, type MediaTilesHandle } from './FilesMediaTiles'
import { TOOLBAR_BTN } from './FilesToolbar'

/** 缩放停手多久后提交尺寸（重新栅格化）。短于 FlowVision 的 400ms。 */
export const MEDIA_SETTLE_MS = 100
/** SVG 无内在尺寸时 `<img>` 报 0，按 CSS 替换元素默认尺寸兜底。 */
const FALLBACK_SIZE = { w: 300, h: 150 }

/** 超大位图：预览图与金字塔要经主进程按项目内路径生成。 */
export type MediaTiledSource = { projectPath: string; path: string }

export type MediaPreviewHandle = { fit: (mode: MediaFitMode) => void }

/**
 * 「1:1」图标：lucide 没有这个字形（`Ratio` / `SquareSlash` 都不是这个意思），按其规范自画——
 * 24 画布、2px 圆头描边、18×18 圆角方框，与同组的 Gallery / Scan 同形。
 * 框内不排文字而是直接描边画：两根竖线当 1（无衬线字体的 1 带左撇，墨迹重心偏右，小尺寸下
 * 看着不居中），冒号用 lucide 惯用的零长度路径 + 圆头帽点成两个点。于是不依赖字体继承、
 * 不受字体度量影响，7–17 对称分布，天然居中。
 */
function RatioOneToOne(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M8 8v8" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 8v8" />
    </svg>
  )
}

/**
 * 工具栏「适应」钮组（看图与 PDF 共用同一组图标与文案）：
 * 自画的 `RatioOneToOne` → 「1:1」（图是像素对像素，PDF 是纸张实际尺寸）；`GalleryVertical` 是纵向堆叠的横条 →
 * 「适应高度」；`GalleryHorizontal` 是横向排列的竖条 → 「适应宽度」；`Scan` 取景框 → 「适应窗口」。
 * 四档互斥点亮，滚轮缩出自由倍率时全灭。
 */
export function MediaFitButtons({
  active,
  onFit
}: {
  /** 当前所处的档；null = 滚轮缩过的自由倍率，四颗都不亮 */
  active: MediaFitMode | null
  onFit: (mode: MediaFitMode) => void
}): React.JSX.Element {
  // 激活态同查找栏方形开关钮：`--selection-row` 蓝底 + 正文色，hover 不再变色
  const cls = (mode: MediaFitMode): string =>
    cn(
      TOOLBAR_BTN,
      active === mode &&
        'bg-[var(--selection-row)] text-foreground hover:bg-[var(--selection-row)] hover:text-foreground'
    )
  return (
    <>
      <button type="button" title="1:1" className={cls('actual')} onClick={() => onFit('actual')}>
        <RatioOneToOne className="size-4" />
      </button>
      <button
        type="button"
        title="适应高度"
        className={cls('height')}
        onClick={() => onFit('height')}
      >
        <GalleryVertical className="size-4" />
      </button>
      <button
        type="button"
        title="适应宽度"
        className={cls('width')}
        onClick={() => onFit('width')}
      >
        <GalleryHorizontal className="size-4" />
      </button>
      <button
        type="button"
        title="适应窗口"
        className={cls('window')}
        onClick={() => onFit('window')}
      >
        <Scan className="size-4" />
      </button>
    </>
  )
}

/** key：超大位图用路径、其余用 src，用来匹配已就绪的金字塔。 */
type Shown = { key: string; src: string; w: number; h: number }

const NO_PREFETCH: readonly string[] = []

function overlayOpen(): boolean {
  return [...document.querySelectorAll('.fixed.inset-0.z-50.flex.items-center')].some(
    (el) => el.getClientRects().length > 0
  )
}

function editableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function wheelPx(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * 400
  return delta
}

/** 先在屏外解码；返回的 Image 要被持有到 `<img>` 接手之后，否则解码结果可能被回收、上屏时先空白一帧。 */
async function decodeImage(src: string): Promise<HTMLImageElement> {
  const im = new Image()
  im.decoding = 'async'
  im.src = src
  try {
    await im.decode()
  } catch {
    /* 解码失败也换上去，让 <img> 自己呈现失败态 */
  }
  return im
}

export function FilesMediaPreview({
  src,
  alt,
  width,
  height,
  tiled = null,
  prefetch = NO_PREFETCH,
  active = true,
  onPrev,
  onNext,
  onFitChange,
  ref
}: {
  src: string
  alt: string
  width?: number
  height?: number
  tiled?: MediaTiledSource | null
  /** 相邻图的 `<img>` URL，提前解码好，切图零等待 */
  prefetch?: readonly string[]
  /** Files Tab 可见且无挡操作的弹层时才响应方向键 */
  active?: boolean
  onPrev?: () => void
  onNext?: () => void
  /** 当前所处的适应档变化（含滚轮缩放与换图导致的退出），供工具栏点亮对应钮 */
  onFitChange?: (mode: MediaFitMode | null) => void
  /** 交工具栏「适应」钮组驱动 */
  ref?: React.Ref<MediaPreviewHandle>
}): React.JSX.Element {
  /** 当前显示的图：新图解码完成前旧图留在屏幕上 */
  const [shown, setShown] = useState<Shown | null>(null)
  /** 已就绪的金字塔按路径记：新图换上之前旧图的瓦片层不拆，两张超大图之间切换不会先退回预览图 */
  const [pyramids, setPyramids] = useState<Record<string, FilesImagePyramid>>({})
  const [panning, setPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const tilesRef = useRef<MediaTilesHandle>(null)
  const camRef = useRef<MediaCamera>({ zoom: 1, x: 0, y: 0 })
  const naturalRef = useRef<{ w: number; h: number } | null>(null)
  /** 已烙进 width/height 的绘制倍率；0 = 尚未提交 */
  const committedRef = useRef(0)
  const settleTimer = useRef(0)
  const dragCleanup = useRef<(() => void) | null>(null)
  /** 持有屏外解码用的 Image：当前图与相邻图的解码结果留在内存缓存里，换 src 不重解 */
  const shownImageRef = useRef<HTMLImageElement | null>(null)
  const prefetchedRef = useRef<HTMLImageElement[]>([])
  /** 当前所处的档；非 null 时视口尺寸一变就按新尺寸重算 */
  const fitModeRef = useRef<MediaFitMode | null>(null)
  const onFitChangeRef = useRef(onFitChange)
  useLayoutEffect(() => {
    onFitChangeRef.current = onFitChange
  })

  const tiledPath = tiled?.path ?? null
  const tiledProject = tiled?.projectPath ?? null
  const activePyramid = shown ? (pyramids[shown.key] ?? null) : null

  /** 相机 → DOM：move 只动 transform；settle 把倍率烙进尺寸让浏览器重新栅格化。 */
  const applyCamera = (cam: MediaCamera, mode: 'move' | 'settle'): void => {
    const vp = viewportRef.current
    const img = imgRef.current
    const nat = naturalRef.current
    if (!vp || !img || !nat) return
    const availW = vp.clientWidth
    const availH = vp.clientHeight
    const s = mediaDrawScale(nat.w, nat.h, availW, availH, cam.zoom)
    if (mode === 'settle' || committedRef.current <= 0) {
      img.style.width = `${nat.w * s}px`
      img.style.height = `${nat.h * s}px`
      img.style.transform = `translate(${cam.x}px, ${cam.y}px)`
      committedRef.current = s
    } else {
      const k = s / committedRef.current
      img.style.transform =
        k === 1
          ? `translate(${cam.x}px, ${cam.y}px)`
          : `translate(${cam.x}px, ${cam.y}px) scale(${k})`
    }
    tilesRef.current?.apply(cam, nat.w, nat.h, availW, availH)
  }
  const applyRef = useRef(applyCamera)
  useLayoutEffect(() => {
    applyRef.current = applyCamera
  })

  const scheduleSettle = (): void => {
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      applyRef.current(camRef.current, 'settle')
    }, MEDIA_SETTLE_MS)
  }

  const setFitMode = useCallback((mode: MediaFitMode | null): void => {
    if (fitModeRef.current === mode) return
    fitModeRef.current = mode
    onFitChangeRef.current?.(mode)
  }, [])

  /** 该档对应的倍率；`window` 就是基准本身（整图可见、小图不放大）。 */
  const zoomFor = (
    mode: MediaFitMode,
    nat: { w: number; h: number },
    availW: number,
    availH: number
  ): number | null => {
    if (mode === 'window') return 1
    if (mode === 'actual') return mediaActualZoom(nat.w, nat.h, availW, availH)
    return mediaFitZoom(mode, nat.w, nat.h, availW, availH)
  }

  /**
   * 切到某一档并立即提交尺寸。
   * 给了 `anchor`（双击点，视口内坐标）就让那一点下的图上点留在原处；否则铺满某条轴时另一轴溢出
   * 顶 / 左对齐（clamp 会把不溢出的轴自动居中），1:1 与适应窗口则居中。
   */
  const fit = useCallback(
    (mode: MediaFitMode, anchor?: { x: number; y: number }): void => {
      const vp = viewportRef.current
      const nat = naturalRef.current
      if (!vp || !nat) return
      const availW = vp.clientWidth
      const availH = vp.clientHeight
      const zoom = zoomFor(mode, nat, availW, availH)
      if (zoom === null) return
      setFitMode(mode)
      camRef.current = anchor
        ? zoomMediaCameraAt(camRef.current, zoom, anchor.x, anchor.y, nat.w, nat.h, availW, availH)
        : mode === 'width' || mode === 'height'
          ? clampMediaCamera({ zoom, x: 0, y: 0 }, nat.w, nat.h, availW, availH)
          : centerMediaCamera(zoom, nat.w, nat.h, availW, availH)
      applyRef.current(camRef.current, 'settle')
    },
    [setFitMode]
  )

  useImperativeHandle(ref, () => ({ fit }), [fit])

  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current)
      dragCleanup.current?.()
    },
    []
  )

  // 解析要显示的图：超大位图先向主进程要预览图；解码完成再换上，旧图不闪
  useEffect(() => {
    let dead = false
    void (async () => {
      let displaySrc = src
      let w = width ?? 0
      let h = height ?? 0
      try {
        if (tiledProject !== null && tiledPath !== null) {
          const preview = await window.api.filesImagePreview(tiledProject, tiledPath)
          if (dead) return
          displaySrc = preview.url
          w = preview.width
          h = preview.height
        }
        const decoded = await decodeImage(displaySrc)
        if (dead) return
        if (!(w > 0 && h > 0)) {
          w = decoded.naturalWidth > 0 ? decoded.naturalWidth : FALLBACK_SIZE.w
          h = decoded.naturalHeight > 0 ? decoded.naturalHeight : FALLBACK_SIZE.h
        }
        shownImageRef.current = decoded
        setShown({ key: tiledPath ?? src, src: displaySrc, w, h })
      } catch {
        /* 预览图失败：保持旧图 */
      }
    })()
    return () => {
      dead = true
    }
  }, [src, width, height, tiledProject, tiledPath])

  // 金字塔：命中缓存即返，否则主进程后台生成（秒级）
  useEffect(() => {
    if (tiledProject === null || tiledPath === null) return
    let dead = false
    const path = tiledPath
    window.api
      .filesImagePyramid(tiledProject, path)
      .then((pyramid) => {
        if (!dead) setPyramids((prev) => ({ ...prev, [path]: pyramid }))
      })
      .catch(() => {
        /* 生成失败：停留在预览图 */
      })
    return () => {
      dead = true
    }
  }, [tiledProject, tiledPath])

  // 换图：装得下视口的图落 1:1，装不下的落「适应窗口」——两者相机同形（zoom=1），只是档位不同
  useLayoutEffect(() => {
    if (!shown) return
    const vp = viewportRef.current
    if (!vp) return
    naturalRef.current = { w: shown.w, h: shown.h }
    committedRef.current = 0
    const availW = vp.clientWidth
    const availH = vp.clientHeight
    setFitMode(mediaFitsViewport(shown.w, shown.h, availW, availH) ? 'actual' : 'window')
    camRef.current = centerMediaCamera(1, shown.w, shown.h, availW, availH)
    applyRef.current(camRef.current, 'settle')
  }, [shown, setFitMode])

  // 瓦片层挂上后同步一次相机（open 前记下、open 后套用）
  useLayoutEffect(() => {
    if (activePyramid) applyRef.current(camRef.current, 'move')
  }, [activePyramid])

  // 视口尺寸一变（拖窗口 / 文件树显隐）：所处的档按新尺寸重算（保留平移量，越界交给 clamp），
  // 自由倍率只夹紧——倍率本就相对「适配视口」记，图本身的比例不会跑掉。
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const nat = naturalRef.current
      if (!nat) return
      const availW = el.clientWidth
      const availH = el.clientHeight
      // Tab 切走是 display:none，容器塌成 0：按 0 算会把相机推到一个无意义的位置，隐藏期间不动
      if (availW <= 0 || availH <= 0) return
      const mode = fitModeRef.current
      const zoom = mode === null ? null : zoomFor(mode, nat, availW, availH)
      camRef.current = clampMediaCamera(
        zoom === null ? camRef.current : { ...camRef.current, zoom },
        nat.w,
        nat.h,
        availW,
        availH
      )
      applyRef.current(camRef.current, 'settle')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const nat = naturalRef.current
      if (!nat) return
      const rect = el.getBoundingClientRect()
      if (e.metaKey || e.ctrlKey) {
        // 自己缩过就不再是「适应」档了，钮灭掉、也不再跟随视口尺寸
        setFitMode(null)
        camRef.current = zoomMediaCameraAt(
          camRef.current,
          zoomFromWheel(camRef.current.zoom, e.deltaY, e),
          e.clientX - rect.left,
          e.clientY - rect.top,
          nat.w,
          nat.h,
          el.clientWidth,
          el.clientHeight
        )
        applyRef.current(camRef.current, 'move')
        scheduleSettle()
        return
      }
      camRef.current = panMediaCamera(
        camRef.current,
        wheelPx(e.deltaX, e.deltaMode),
        wheelPx(e.deltaY, e.deltaMode),
        nat.w,
        nat.h,
        el.clientWidth,
        el.clientHeight
      )
      applyRef.current(camRef.current, 'move')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setFitMode])

  useEffect(() => {
    const list = prefetch.map((url) => {
      const im = new Image()
      im.decoding = 'async'
      im.src = url
      void im.decode().catch(() => {})
      return im
    })
    // 持有引用，解码结果才留在内存缓存里
    prefetchedRef.current = list
  }, [prefetch])

  useEffect(() => {
    if (!active || (!onPrev && !onNext)) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown'
      ) {
        return
      }
      if (editableTarget(e.target) || overlayOpen()) return
      const app = useApp.getState()
      if (app.contentSearchOpen || app.dialog.open) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onPrev?.()
      else onNext?.()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, onPrev, onNext])

  /** 键盘缩放：按视口中心走，离开所有档位（同滚轮缩放）。 */
  const stepZoom = useCallback(
    (factor: number): void => {
      const el = viewportRef.current
      const nat = naturalRef.current
      if (!el || !nat) return
      const availW = el.clientWidth
      const availH = el.clientHeight
      setFitMode(null)
      camRef.current = zoomMediaCameraAt(
        camRef.current,
        camRef.current.zoom * factor,
        availW / 2,
        availH / 2,
        nat.w,
        nat.h,
        availW,
        availH
      )
      applyRef.current(camRef.current, 'settle')
    },
    [setFitMode]
  )

  // Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 逐档缩放。这三个键已从应用菜单的视图块里摘掉
  //（Electron 的 viewMenu 自带整页缩放，菜单加速键优先级更高，留着就压住这里）。
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      // Cmd+= 与 Cmd+Shift+= 都算放大（后者就是键盘上的 Cmd++）；回基准视图则不许带 Shift
      const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd'
      const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract'
      const reset = e.code === 'Digit0' && !e.shiftKey
      if (!zoomIn && !zoomOut && !reset) return
      if (editableTarget(e.target) || overlayOpen()) return
      const app = useApp.getState()
      if (app.contentSearchOpen || app.dialog.open) return
      e.preventDefault()
      e.stopPropagation()
      if (reset) fit('window')
      else stepZoom(zoomIn ? MEDIA_ZOOM_STEP : 1 / MEDIA_ZOOM_STEP)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, fit, stepZoom])

  const startPan = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = viewportRef.current
    const nat = naturalRef.current
    if (!el || !nat) return
    // 双击换档从 mousedown 的点击计数判定，不接 dblclick：拖拽期间盖着的全屏遮罩会接走 mouseup，
    // click / dblclick 的 target 退化成两者的共同祖先，永远落不到这里
    if (e.detail === 2) {
      const rect = el.getBoundingClientRect()
      fit(fitModeRef.current === 'width' ? 'height' : 'width', {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      })
      return
    }
    e.preventDefault()
    const origin = { x: e.clientX, y: e.clientY, cam: { ...camRef.current } }
    setPanning(true)
    const onMove = (ev: MouseEvent): void => {
      camRef.current = panMediaCamera(
        origin.cam,
        origin.x - ev.clientX,
        origin.y - ev.clientY,
        nat.w,
        nat.h,
        el.clientWidth,
        el.clientHeight
      )
      applyRef.current(camRef.current, 'move')
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

  return (
    <div className="relative min-h-0 flex-1 bg-deepest">
      <div
        ref={viewportRef}
        className={cn(
          'relative h-full min-h-0 touch-none overflow-hidden select-none',
          panning ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onMouseDown={startPan}
      >
        {shown && (
          // 同步解码：换 src 或提交尺寸需要新解码时宁可等一下，也不像 async 那样先画空白帧再补
          <img
            ref={imgRef}
            src={shown.src}
            alt={alt}
            draggable={false}
            decoding="sync"
            className="absolute top-0 left-0 max-w-none origin-top-left will-change-transform"
          />
        )}
        {/* 预览图留在瓦片层底下：垫住尚未加载的瓦片，瓦片就绪也不切换、不闪 */}
        {activePyramid && <FilesMediaTiles ref={tilesRef} pyramid={activePyramid} />}
      </div>
      {shown && (
        <div className="pointer-events-none absolute top-2 right-2 text-[12px] text-[color:var(--fg-info)]">
          {shown.w} × {shown.h}
        </div>
      )}
      {panning && <div className="fixed inset-0 z-50 cursor-grabbing" />}
    </div>
  )
}

export function FilesSvgPreview({
  path,
  content,
  prefetch,
  active,
  onPrev,
  onNext,
  onFitChange,
  ref
}: {
  path: string
  content: string
  prefetch?: readonly string[]
  active?: boolean
  onPrev?: () => void
  onNext?: () => void
  onFitChange?: (mode: MediaFitMode | null) => void
  ref?: React.Ref<MediaPreviewHandle>
}): React.JSX.Element {
  const src = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`,
    [content]
  )
  return (
    <FilesMediaPreview
      key={path}
      src={src}
      alt={path}
      prefetch={prefetch}
      active={active}
      onPrev={onPrev}
      onNext={onNext}
      onFitChange={onFitChange}
      ref={ref}
    />
  )
}
