// Files Tab · 位图 / SVG 预览：居中 `<img>`，内容区右上角显示像素宽高。
// SVG 走 data URL（CSP 已放行 data:），不当 inline XML，脚本不执行。
// Cmd/Ctrl+滚轮按光标缩放；滚轮或按住拖拽平移；方向键切同一目录上一张 / 下一张。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useApp } from '@renderer/store'
import { cn } from '@renderer/lib/utils'
import {
  clampMediaZoom,
  imagePointFromCursor,
  mediaDisplaySize,
  scrollToImagePoint,
  zoomFromWheel
} from '@renderer/lib/files-media-zoom'

type MagGesture = Event & { scale: number; clientX: number; clientY: number }

function overlayOpen(): boolean {
  return [...document.querySelectorAll('.fixed.inset-0.z-50.flex.items-center')].some(
    (el) => el.getClientRects().length > 0
  )
}

function editableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export function FilesMediaPreview({
  src,
  alt,
  active = true,
  onPrev,
  onNext
}: {
  src: string
  alt: string
  /** Files Tab 可见且无挡操作的弹层时才响应方向键 */
  active?: boolean
  onPrev?: () => void
  onNext?: () => void
}): React.JSX.Element {
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const naturalRef = useRef(natural)
  const zoomRef = useRef(zoom)
  const dragCleanup = useRef<(() => void) | null>(null)
  const [panning, setPanning] = useState(false)

  useLayoutEffect(() => {
    naturalRef.current = natural
    zoomRef.current = zoom
  })

  useEffect(() => () => dragCleanup.current?.(), [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const sync = (): void => setViewport({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const display =
    natural !== null && natural.src === src && viewport.w > 0 && viewport.h > 0
      ? mediaDisplaySize(natural.w, natural.h, viewport.w, viewport.h, zoom)
      : null

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const pinch = { usingGesture: false, startZoom: 1 }
    const applyZoomAt = (newZoom: number, clientX: number, clientY: number): void => {
      const nat = naturalRef.current
      const z = zoomRef.current
      if (nat === null || nat.src !== src || newZoom === z) return
      const availW = el.clientWidth
      const availH = el.clientHeight
      const rect = el.getBoundingClientRect()
      const oldSize = mediaDisplaySize(nat.w, nat.h, availW, availH, z)
      const newSize = mediaDisplaySize(nat.w, nat.h, availW, availH, newZoom)
      const ratio = oldSize.w === 0 ? 1 : newSize.w / oldSize.w
      const cursorX = clientX - rect.left
      const cursorY = clientY - rect.top
      const pt = imagePointFromCursor({
        cursorX,
        cursorY,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        viewportW: availW,
        viewportH: availH,
        displayW: oldSize.w,
        displayH: oldSize.h
      })
      const next = scrollToImagePoint({
        imageX: pt.x * ratio,
        imageY: pt.y * ratio,
        cursorX,
        cursorY,
        viewportW: availW,
        viewportH: availH,
        displayW: newSize.w,
        displayH: newSize.h
      })
      zoomRef.current = newZoom
      // 捏合每帧多次事件：同一帧把尺寸提交到 DOM，否则锚点对不准。
      flushSync(() => setZoom(newZoom))
      el.scrollLeft = next.left
      el.scrollTop = next.top
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      if (pinch.usingGesture) return
      applyZoomAt(zoomFromWheel(zoomRef.current, e.deltaY, e), e.clientX, e.clientY)
    }
    // Safari / 部分 WebKit：scale 从手势起点累计，对齐 FlowVision initialScale * (1+magnification)
    const onGestureStart = (e: Event): void => {
      e.preventDefault()
      pinch.usingGesture = true
      pinch.startZoom = zoomRef.current
    }
    const onGestureChange = (e: Event): void => {
      e.preventDefault()
      const scale = (e as MagGesture).scale
      if (!Number.isFinite(scale) || scale <= 0) return
      applyZoomAt(
        clampMediaZoom(pinch.startZoom * scale),
        (e as MagGesture).clientX,
        (e as MagGesture).clientY
      )
    }
    const onGestureEnd = (e: Event): void => {
      e.preventDefault()
      pinch.usingGesture = false
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    el.addEventListener('gesturecancel', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
      el.removeEventListener('gesturecancel', onGestureEnd)
    }
  }, [src])

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

  // 拖拽平移（同内容搜索分隔线：全局 mousemove / mouseup，拖中全屏遮罩保光标）
  const startPan = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const el = viewportRef.current
    if (!el) return
    e.preventDefault()
    const origin = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setPanning(true)
    const onMove = (ev: MouseEvent): void => {
      el.scrollLeft = origin.left - (ev.clientX - origin.x)
      el.scrollTop = origin.top - (ev.clientY - origin.y)
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
          'h-full min-h-0 overflow-auto select-none',
          panning ? 'cursor-grabbing' : 'cursor-grab'
        )}
        onMouseDown={startPan}
      >
        <div className="flex h-fit min-h-full w-fit min-w-full items-center justify-center">
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={display ? 'max-w-none' : 'max-h-full max-w-full object-contain'}
            style={display ? { width: display.w, height: display.h } : undefined}
            onLoad={(e) => {
              const el = e.currentTarget
              setNatural({ src, w: el.naturalWidth, h: el.naturalHeight })
            }}
            onError={() => setNatural((prev) => (prev?.src === src ? null : prev))}
          />
        </div>
      </div>
      {natural !== null && natural.src === src && (
        <div className="pointer-events-none absolute top-2 right-2 text-[12px] text-[color:var(--fg-info)]">
          {natural.w} × {natural.h}
        </div>
      )}
      {panning && <div className="fixed inset-0 z-50 cursor-grabbing" />}
    </div>
  )
}

export function FilesSvgPreview({
  path,
  content,
  active,
  onPrev,
  onNext
}: {
  path: string
  content: string
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
      active={active}
      onPrev={onPrev}
      onNext={onNext}
    />
  )
}
