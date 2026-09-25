/**
 * Files 面板各正文（看图 / PDF / 音视频）的全局键盘监听共用的守卫：
 * 不抢输入框与弹层，不要求焦点落在预览内。
 */

/** 有弹层正开着：居中对话框（设置 / 表单等），或下拉 / 右键菜单（方向键、回车归菜单自己导航） */
export function overlayOpen(): boolean {
  return [
    ...document.querySelectorAll('.fixed.inset-0.z-50.flex.items-center, [role="menu"]')
  ].some((el) => el.getClientRects().length > 0)
}

/** 事件目标是可输入控件 */
export function editableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** 无修饰键的方向键 → -1（← / ↑）或 1（→ / ↓）；其它为 null */
export function arrowDirection(e: KeyboardEvent): -1 | 1 | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return 1
  return null
}
