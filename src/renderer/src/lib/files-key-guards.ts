/**
 * Files 面板的键盘处理（文件面板自己的、各正文的）共用的守卫：按键此刻的处境，与方向键归谁
 * （docs/prd/files-tab.md「按键归属」、ADR-0066；判定本身在 files-key-route）。
 */
import { createContext } from 'react'
import { isDialogOpen } from '@renderer/components/ui/dialog'
import {
  filesArrowOwner,
  isFilesArrowKey,
  type FilesArrowContent,
  type FilesArrowOwner,
  type FilesKeyScope
} from './files-key-route'

/** 有弹层正开着：弹窗（设置 / 表单 / 内容搜索等），或下拉 / 右键菜单（方向键、回车归菜单自己导航） */
export function overlayOpen(): boolean {
  return (
    isDialogOpen() ||
    [...document.querySelectorAll('[role="menu"]')].some((el) => el.getClientRects().length > 0)
  )
}

/** 事件目标是可输入控件；滑杆不算（拖完音量焦点留在滑杆上，播放键照常归播放器） */
export function editableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.closest('input:not([type="range"]), textarea, select, [contenteditable="true"]') !== null
  )
}

/** 元素所在的「进得去」的正文（根上标着 CONTENT_ATTR，见 content-focus）；不在任何一个里为 null */
export function filesContentOf(el: EventTarget | null): Element | null {
  return el instanceof Element ? el.closest('[data-content]') : null
}

/** 一次按键的处境（见 FilesKeyScope）：文件树的滚动区标着 data-files-tree，焦点在里面即在文件树上 */
export function filesKeyScope(target: EventTarget | null): FilesKeyScope {
  if (overlayOpen()) return 'blocked'
  if (editableTarget(target)) return 'typing'
  if (filesContentOf(target) !== null) return 'content'
  return target instanceof Element && target.closest('[data-files-tree]') !== null ? 'tree' : 'idle'
}

/**
 * 文件树的焦点行此刻是不是文件夹（← / → 归文件树开合），由 FilesPane 给；各正文的键盘处理按键时读，
 * 不随选中变化重挂监听。面板之外用到的正文（没有文件树）恒为否。
 */
export const FilesTreeRowContext = createContext<() => boolean>(() => false)

/** 这次按键是不带 ⌘ / Ctrl / ⌥ 的方向键时它归谁；不是方向键为 null */
export function arrowOwnerOf(
  e: KeyboardEvent,
  content: FilesArrowContent,
  treeRowIsDirectory: boolean
): FilesArrowOwner {
  if (e.metaKey || e.ctrlKey || e.altKey || !isFilesArrowKey(e.key)) return null
  return filesArrowOwner(e.key, e.shiftKey, {
    scope: filesKeyScope(e.target),
    treeRowIsDirectory,
    content
  })
}
