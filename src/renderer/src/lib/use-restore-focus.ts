import { useEffect, useState } from 'react'

/**
 * 弹层（错误框、叠在对话框上的确认框）关掉后把焦点还给打开前的元素，如表单里的输入框、点开它的按钮。
 * 首次渲染时记下当时的焦点——此时弹层还没挂上，autoFocus 还没把焦点移进来。卸载时只在焦点随弹层一起消失（落回 body）
 * 且原元素仍在页面上时才还：焦点已被移到别处的不抢，原元素随下层一起关掉的不还；开发模式 StrictMode 模拟卸载时弹层还在、
 * 焦点还在弹层里，也不会被拽走。
 */
export function useRestoreFocus(): void {
  const [previous] = useState(() => document.activeElement)
  useEffect(
    () => () => {
      if (document.activeElement !== document.body) return
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    },
    [previous]
  )
}
