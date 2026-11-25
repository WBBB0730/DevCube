/**
 * Files Tab 分页文档预览（PDF / PPT）共用的操作外壳：键盘、拖拽抓手、Cmd/Ctrl+滚轮缩放；表格预览只借键盘与滚轮缩放，
 * 文本编辑器与 Markdown 预览只借查找键。
 * 渲染引擎各管各的，这里只把用户操作翻译成回调（docs/prd/files-pdf-preview.md、files-pptx-preview.md、files-xlsx-preview.md）。
 */
import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import {
  arrowOwnerOf,
  editableTarget,
  FilesTreeRowContext,
  filesKeyScope
} from './files-key-guards'
import { filesScrollStep, reachesContent } from './files-key-route'
import { selectedTextWithin } from './find-seed'
import { zoomFromWheel } from './files-media-zoom'
import { isPrimaryModifierEvent } from './shortcut-label'

/** 翻页滚动一次走视口高的多少（同 Chromium 原生的 PageDown） */
const SCROLL_PAGE_RATIO = 0.875

/**
 * 正文的键盘（归属见 files-key-route，docs/prd/files-tab.md「按键归属」）：
 * - Cmd/Ctrl+F 打开查找、Esc（焦点在预览内）关闭；
 * - Cmd/Ctrl+0 回基准倍率（分页文档 = 适应窗口，表格 = 工作表自带倍率）、Cmd/Ctrl +/- 逐档缩放。这三个键已从应用菜单的视图块里摘掉
 *  （Electron 的 viewMenu 自带整页缩放，菜单加速键优先级更高，留着就压住这里，见 ADR-0019）。
 *   不给缩放回调的正文（文本、Markdown）这三个键一概不接；
 * - 翻页滚动（PageUp / PageDown / Home / End / 空格）：焦点不在正文里（在文件树上或别处）时也滚这份正文；进了正文的
 *   由浏览器原生处理。不给滚动容器的正文不接；
 * - 分页文档（给了翻页回调的）：← / → 上一页 / 下一页，两边都接，到头停下；↑ / ↓ 只在进了正文后翻页，已在第一页 /
 *   最后一页时再按就换文件（没进正文时 ↑ / ↓ 归文件树）。不给翻页回调的正文（表格：方向键归格子）这几个键一概不接。
 * 查找与缩放不看焦点，只在弹层开着时让位。
 */
export function usePagedPreviewKeys({
  active,
  rootRef,
  findOpen,
  openFind,
  closeFind,
  resetZoom,
  stepZoom,
  getScroller,
  getPage,
  goToPage,
  onPrevFile,
  onNextFile
}: {
  /** Files Tab 可见且这一栏是当前栏时才响应 */
  active: boolean
  rootRef: RefObject<HTMLElement | null>
  findOpen: boolean
  /** 带上预览里选中的文字（预填查找框，见 findSeed） */
  openFind: (selection: string) => void
  closeFind: () => void
  resetZoom?: () => void
  stepZoom?: (steps: 1 | -1) => void
  /** 正文的滚动容器（翻页滚动的键滚它）；还没有时为 null。要保持同一个引用 */
  getScroller?: () => HTMLElement | null
  /** 当前页（1 起）与总页数；文档未就绪为 null，方向键不接管；不分页的正文不给 */
  getPage?: () => { page: number; pages: number } | null
  goToPage?: (page: number) => void
  /** 进了正文后在第一页按 ↑ / 最后一页按 ↓：换到文件树里的上一个 / 下一个文件 */
  onPrevFile?: () => void
  onNextFile?: () => void
}): void {
  const treeRowIsDirectory = useContext(FilesTreeRowContext)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const root = rootRef.current
      if (!root) return
      const target = e.target
      const mod = isPrimaryModifierEvent(e)
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (filesKeyScope(target) === 'blocked') return
        e.preventDefault()
        e.stopPropagation()
        openFind(selectedTextWithin(root))
        return
      }
      if (mod && !e.altKey && resetZoom && stepZoom) {
        // Cmd+= 与 Cmd+Shift+= 都算放大（后者就是键盘上的 Cmd++）；回基准视图则不许带 Shift
        const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd'
        const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract'
        const reset = e.code === 'Digit0' && !e.shiftKey
        if (zoomIn || zoomOut || reset) {
          if (filesKeyScope(target) === 'blocked') return
          e.preventDefault()
          e.stopPropagation()
          if (reset) resetZoom()
          else stepZoom(zoomIn ? 1 : -1)
          return
        }
      }
      const scroll = mod || e.altKey ? null : filesScrollStep(e.key, e.shiftKey)
      if (scroll !== null) {
        const scroller = getScroller?.()
        if (!scroller || !reachesContent(filesKeyScope(target))) return
        e.preventDefault()
        e.stopPropagation()
        if (scroll === 'start') scroller.scrollTo({ top: 0 })
        else if (scroll === 'end') scroller.scrollTo({ top: scroller.scrollHeight })
        else scroller.scrollBy({ top: scroll * scroller.clientHeight * SCROLL_PAGE_RATIO })
        return
      }
      if (getPage && goToPage && arrowOwnerOf(e, 'paged', treeRowIsDirectory()) === 'content') {
        const at = getPage()
        if (!at) return
        e.preventDefault()
        e.stopPropagation()
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        const edge = back ? at.page <= 1 : at.page >= at.pages
        if (!edge) goToPage(at.page + (back ? -1 : 1))
        else if (e.key === 'ArrowUp') onPrevFile?.()
        else if (e.key === 'ArrowDown') onNextFile?.()
        return
      }
      const inside = target instanceof Node && root.contains(target)
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
    resetZoom,
    stepZoom,
    getScroller,
    getPage,
    goToPage,
    onPrevFile,
    onNextFile,
    treeRowIsDirectory
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
