/** Files Tab 路径小工具（工具栏与面板共用；纯函数，不碰 DOM）。 */

/** 绝对逻辑路径相对项目根的部分；根自身为空串，根外原样返回。 */
export function relPathUnderRoot(projectRoot: string, absolute: string): string {
  if (absolute === projectRoot) return ''
  if (absolute.startsWith(projectRoot + '/')) return absolute.slice(projectRoot.length + 1)
  return absolute
}

/** 逻辑路径转系统路径（macOS/Linux 上通常相同）。 */
export function toSysPath(logical: string): string {
  return logical
}
