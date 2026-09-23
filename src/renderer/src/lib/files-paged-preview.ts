/**
 * Files Tab 分页文档预览（PDF / PPT）共用的操作外壳：键盘、拖拽抓手、Cmd/Ctrl+滚轮缩放。
 * 渲染引擎各管各的，这里只把用户操作翻译成回调（docs/prd/files-pdf-preview.md、files-pptx-preview.md）。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useApp } from '@renderer/store'
import { editableTarget, overlayOpen } from './files-key-guards'
import { zoomFromWheel } from './files-media-zoom'

/** 应用级弹层 / 内容搜索 / 对话框开着时，预览的全局快捷键一律让路 */
function appBusy(): boolean {
  const app = useApp.getState()
  return overlayOpen() || app.contentSearchOpen || app.dialog.open
}

/**
 * 预览的全局键盘：
 * - Cmd/Ctrl+F 打开查找、Esc（焦点在预览内）关闭；
 * - Cmd/Ctrl+0 回适应窗口、Cmd/Ctrl +/- 逐档缩放。这三个键已从应用菜单的视图块里摘掉
 *  （Electron 的 viewMenu 自带整页缩放，菜单加速键优先级更高，留着就压住这里，见 ADR-0019）；
 * - ←/→ 切上一个 / 下一个媒体文件；↑/↓ 始终上一页 / 下一页（不看档位，正文与缩略图侧栏内都如此），
 *   已在第一页 / 最后一页时再按就切文件——同看图的方向键切图：不抢输入框与弹层，不要求焦点在预览内。
 * Cmd+F / 缩放要求焦点在预览内或无焦点。
 */
export function usePagedPreviewKeys({
  active,
  rootRef,
  findOpen,
  openFind,
  closeFind,
  fitWindow,
  stepZoom,
  getPage,
  goToPage,
  onPrevFile,
  onNextFile
}: {
  /** Files Tab 可见时才响应 */
  active: boolean
  rootRef: RefObject<HTMLElement | null>
  findOpen: boolean
  openFind: () => void
  closeFind: () => void
  fitWindow: () => void
  stepZoom: (steps: 1 | -1) => void
  /** 当前页（1 起）与总页数；文档未就绪为 null，↑/↓ 不接管 */
  getPage: () => { page: number; pages: number } | null
  goToPage: (page: number) => void
  onPrevFile?: () => void
  onNextFile?: () => void
}): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root) return
      const target = e.target
      const inside = target instanceof Node && root.contains(target)
      /** 预览内或无焦点（焦点在 body），且不在输入框 */
      const focusedHere = (): boolean =>
        inside || (target === document.body && !editableTarget(target))
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (!focusedHere() || appBusy()) return
        e.preventDefault()
        e.stopPropagation()
        openFind()
        return
      }
      if (mod && !e.altKey) {
        // Cmd+= 与 Cmd+Shift+= 都算放大（后者就是键盘上的 Cmd++）；回基准视图则不许带 Shift
        const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd'
        const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract'
        const reset = e.code === 'Digit0' && !e.shiftKey
        if (zoomIn || zoomOut || reset) {
          if (!focusedHere() || appBusy()) return
          e.preventDefault()
          e.stopPropagation()
          if (reset) fitWindow()
          else stepZoom(zoomIn ? 1 : -1)
          return
        }
      }
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      if (
        plain &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        (onPrevFile || onNextFile)
      ) {
        if (editableTarget(target) || appBusy()) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowLeft') onPrevFile?.()
        else onNextFile?.()
        return
      }
      if (plain && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (editableTarget(target) || appBusy()) return
        const at = getPage()
        if (!at) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowUp') {
          if (at.page <= 1) onPrevFile?.()
          else goToPage(at.page - 1)
        } else if (at.page >= at.pages) onNextFile?.()
        else goToPage(at.page + 1)
        return
      }
      if (e.key === 'Escape' && findOpen && inside && !editableTarget(target)) {
        e.preventDefault()
        closeFind()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    active,
    rootRef,
    findOpen,
    openFind,
    closeFind,
    fitWindow,
    stepZoom,
    getPage,
    goToPage,
    onPrevFile,
    onNextFile
  ])
}

/**
 * 拖拽平移（抓手）：`passThrough` 为真的位置（文字、链接等）让给原生选字与点击，其余位置按住拖动
 * 抓着滚动容器走；按住空格则处处抓手（拦掉原生空格翻页），光标 grab / grabbing 同看图。
 * 空白处双击交给 `onDoubleClick`（锚点为容器内坐标）。双击从 mousedown 的 `detail === 2` 判定而不接
 * `dblclick`：拖拽期间盖着的全屏遮罩会接走 mouseup，click / dblclick 的 target 退化成两者的共同祖先，
 * 永远落不到预览区；文字上已让路，原生双击选词不受影响。
 */
export function usePreviewPan({
  active,
  rootRef,
  containerRef,
  enabled,
  passThrough,
  onDoubleClick
}: {
  active: boolean
  rootRef: RefObject<HTMLElement | null>
  containerRef: RefObject<HTMLElement | null>
  /** 文档就绪才接管 */
  enabled: boolean
  passThrough: (target: EventTarget | null) => boolean
  onDoubleClick: (anchor: { x: number; y: number }) => void
}): {
  panning: boolean
  spaceHeld: boolean
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void
} {
  const [panning, setPanning] = useState(false)
  /** 空格按住 = 抓手修饰键；ref 给事件处理读，state 给光标样式 */
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const dragCleanup = useRef<(() => void) | null>(null)

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
  }, [active, rootRef])

  const onMouseDown = (e: React.MouseEvent<HTMLElement>): void => {
    if (e.button !== 0) return
    const container = containerRef.current
    if (!container || !enabled) return
    if (!spaceRef.current && passThrough(e.target)) return
    if (e.detail === 2) {
      const rect = container.getBoundingClientRect()
      onDoubleClick({ x: e.clientX - rect.left, y: e.clientY - rect.top })
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

  return { panning, spaceHeld, onMouseDown }
}

/**
 * Cmd/Ctrl+滚轮与触控板捏合：按光标缩放，倍率常量复用看图（`zoomFromWheel`）；普通滚轮不拦，原生滚动。
 * `origin` 为 `targetRef` 元素内坐标。
 */
export function useCtrlWheelZoom(
  targetRef: RefObject<HTMLElement | null>,
  onZoom: (factor: number, origin: { x: number; y: number }) => void
): void {
  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      onZoom(zoomFromWheel(1, e.deltaY, e), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [targetRef, onZoom])
}
