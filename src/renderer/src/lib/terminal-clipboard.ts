/**
 * 终端里按键对应的复制 / 粘贴（macOS 的 ⌘C / ⌘V 走编辑菜单，不经这里）：
 * - Windows：Ctrl+C 有选中时复制、没选中仍是中断，Ctrl+Shift+C 复制；Ctrl+V、Ctrl+Shift+V 粘贴
 * - Linux：Ctrl+Shift+C 复制、Ctrl+Shift+V 粘贴；Ctrl+C、Ctrl+V 照旧交给终端
 */
export function terminalClipboardAction(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  platform: string,
  hasSelection: boolean
): 'copy' | 'paste' | null {
  if (platform === 'darwin' || !e.ctrlKey || e.altKey || e.metaKey) return null
  const key = e.key.toLowerCase()
  if (platform === 'win32') {
    if (key === 'c' && (e.shiftKey || hasSelection)) return 'copy'
    return key === 'v' ? 'paste' : null
  }
  if (!e.shiftKey) return null
  if (key === 'c') return 'copy'
  return key === 'v' ? 'paste' : null
}
