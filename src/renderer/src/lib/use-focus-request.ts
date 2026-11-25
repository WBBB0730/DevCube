import { useEffect, useRef, type RefObject } from 'react'

/**
 * 聚焦请求到了（nonce 每次 +1，如 ⌥⌘P / ⌥⌘F）就聚焦输入框并选中已有内容，方便直接覆盖输入。只认挂载之后的请求：
 * 挂载之前按过的不补。
 */
export function useFocusRequest(nonce: number, inputRef: RefObject<HTMLInputElement | null>): void {
  const handled = useRef(nonce)
  useEffect(() => {
    if (nonce === handled.current) return
    handled.current = nonce
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [nonce, inputRef])
}
