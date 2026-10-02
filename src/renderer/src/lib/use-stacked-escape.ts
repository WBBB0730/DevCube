import { useEffect, useEffectEvent, type RefObject } from 'react'

/** 叠着的弹层，按打开的先后：Esc 交给最上面（最后打开）且显示着的那一层。 */
const layers: { close: () => void; ref?: RefObject<HTMLElement | null> }[] = []

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!
    // 看不见（所在面板被隐藏）的不收，交给下面一层
    if (layer.ref !== undefined && (layer.ref.current?.getClientRects().length ?? 0) === 0) continue
    e.stopImmediatePropagation()
    layer.close()
    return
  }
}

/**
 * 叠在别的对话框之上的弹层：Esc 在捕获阶段先由它收下，只关它自己——下层对话框（FormDialogShell）也在 window 上
 * 监听 Esc，不拦住的话一次 Esc 会把两层都关掉。几层同时开着时（如选目录对话框连接时又弹出 SSH 提问），只关最上面的。
 * 给了 ref 时只在它显示着才收：弹层放在可能被隐藏的面板里（如切走的 Tab 里的错误框），看不见时不拦 Esc。
 */
export function useStackedEscape(onClose: () => void, ref?: RefObject<HTMLElement | null>): void {
  // 关闭回调换了不重新登记：重新登记会把这一层挪到最上面
  const close = useEffectEvent(onClose)
  useEffect(() => {
    const layer = { close: () => close(), ref }
    layers.push(layer)
    if (layers.length === 1) window.addEventListener('keydown', onKey, true)
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      if (layers.length === 0) window.removeEventListener('keydown', onKey, true)
    }
  }, [ref])
}
