import { useRef } from 'react'

/**
 * 连续点击里本次是第几下：`detail > 1` 视为续上一击（双击间隔、位移容差随系统），否则开新一串
 * （键盘触发的 click 为 0，同样从 1 起）。
 * 不直接用 `detail`：macOS 取系统点击计数一路累加，Windows / Linux 由 Chromium 自己计数、封顶 3。
 */
export function nextClickIndex(prev: number, detail: number): number {
  return detail > 1 ? prev + 1 : 1
}

/**
 * 双击判定（替代 `dblclick`）：连续点击里第 2、4、6… 下各算一次双击，连续双击可来回切换
 * （同 Swing JTree 的 `clickCount % 2 == 0`）。`dblclick` 只在 `detail` 正好为 2 时补发，
 * 同一串里之后的双击都会被吞掉。
 */
export function useDoubleClick(): (e: React.MouseEvent) => boolean {
  const indexRef = useRef(0)
  return (e) => {
    indexRef.current = nextClickIndex(indexRef.current, e.detail)
    return indexRef.current % 2 === 0
  }
}
