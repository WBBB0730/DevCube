import { useEffect, type RefObject } from 'react'

/**
 * 叠在别的对话框之上的弹层：Esc 在捕获阶段先由它收下，只关它自己——下层对话框（FormDialogShell）也在 window 上
 * 监听 Esc，不拦住的话一次 Esc 会把两层都关掉。
 * 给了 ref 时只在它显示着才收：弹层放在可能被隐藏的面板里（如切走的 Tab 里的错误框），看不见时不拦 Esc。
 */
export function useStackedEscape(onClose: () => void, ref?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 看不见（所在面板被隐藏）时不收，Esc 照常往下走
      if (ref !== undefined && (ref.current?.getClientRects().length ?? 0) === 0) return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, ref])
}
