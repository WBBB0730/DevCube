/** Files Tab 路径小工具（工具栏与面板共用；纯函数，不碰 DOM）。 */
import { childPathPrefix } from '@shared/files-path'

/** 绝对逻辑路径相对根的部分；根自身为空串，根外原样返回（根可以是 `/`、`C:/`、`//主机/共享`）。 */
export function relPathUnderRoot(root: string, absolute: string): string {
  if (absolute === root) return ''
  const prefix = childPathPrefix(root)
  if (absolute.startsWith(prefix)) return absolute.slice(prefix.length)
  return absolute
}
