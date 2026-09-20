// Files Tab · 位图 / SVG 预览：浏览器原生 `<img>` 流水线（ADR-0029）。
// 手势期间只改 transform（合成器，不重排、不重解码）；缩放停手后把倍率烙进 width/height，
// Chromium 按新尺寸重新栅格化，任何倍率都清晰（PhotoSwipe / macOS 预览同法）。
// 超大位图（tiled）先显示主进程出的预览图，金字塔就绪后在其上叠 OpenSeadragon 瓦片层（预览图留在底下垫着），同一相机驱动。
// 换图先屏外解码再换 src、`<img>` 同步解码，切图与提交尺寸都不会画出空白帧。
// SVG 走 data URL（CSP 已放行 data:），不当 inline XML，脚本不执行。
// Cmd/Ctrl+滚轮按光标缩放（触控板捏合是 Chromium 合成的 ctrl+wheel）；滚轮或按住拖拽平移；
// 方向键切同一目录上一张 / 下一张。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@renderer/store'
import { cn } from '@renderer/lib/utils'
import type { FilesImagePyramid } from '@shared/files-image-tiles'
import {
  centerMediaCamera,
  clampMediaCamera,
  mediaDrawScale,
  panMediaCamera,
  zoomFromWheel,
  zoomMediaCameraAt,
  type MediaCamera
} from '@renderer/lib/files-media-zoom'
import { FilesMediaTiles, type MediaTilesHandle } from './FilesMediaTiles'

/** 缩放停手多久后提交尺寸（重新栅格化）。短于 FlowVision 的 400ms。 */
export const MEDIA_SETTLE_MS = 100
/** SVG 无内在尺寸时 `<img>` 报 0，按 CSS 替换元素默认尺寸兜底。 */
const FALLBACK_SIZE = { w: 300, h: 150 }

/** 超大位图：预览图与金字塔要经主进程按项目内路径生成。 */
export type MediaTiledSource = { projectPath: string; path: string }

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
  onNext
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

  // 换图：回到适配视口并提交尺寸
  useLayoutEffect(() => {
    if (!shown) return
    const vp = viewportRef.current
    if (!vp) return
    naturalRef.current = { w: shown.w, h: shown.h }
    committedRef.current = 0
    camRef.current = centerMediaCamera(1, shown.w, shown.h, vp.clientWidth, vp.clientHeight)
    applyRef.current(camRef.current, 'settle')
  }, [shown])

  // 瓦片层挂上后同步一次相机（open 前记下、open 后套用）
  useLayoutEffect(() => {
    if (activePyramid) applyRef.current(camRef.current, 'move')
  }, [activePyramid])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const nat = naturalRef.current
      if (!nat) return
      camRef.current = clampMediaCamera(
        camRef.current,
        nat.w,
        nat.h,
        el.clientWidth,
        el.clientHeight
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
  }, [])

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

  const startPan = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = viewportRef.current
    const nat = naturalRef.current
    if (!el || !nat) return
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
  onNext
}: {
  path: string
  content: string
  prefetch?: readonly string[]
  active?: boolean
  onPrev?: () => void
  onNext?: () => void
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
    />
  )
}
