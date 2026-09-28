/** Files Tab 路径小工具（工具栏与面板共用；纯函数，不碰 DOM）。 */
import { childPathPrefix } from '@shared/files-path'

/** 绝对逻辑路径相对根的部分；根自身为空串，根外原样返回（根可以是 `/`、`C:/`）。 */
export function relPathUnderRoot(root: string, absolute: string): string {
  if (absolute === root) return ''
  const prefix = childPathPrefix(root)
  if (absolute.startsWith(prefix)) return absolute.slice(prefix.length)
  return absolute
}

/** 逻辑路径转系统路径（macOS/Linux 上通常相同）。 */
export function toSysPath(logical: string): string {
  return logical
}
