import { normalizePath } from '../shared/files-path'
import { getProjects } from './store'

/**
 * Files 面板的根授权表（docs/prd/file-preview-window.md）：主进程的目录列举 / 读写 /
 * 媒体协议 / 瓦片只放行「已登记 Project 根」与「Preview Window 当前根」之内的路径。
 * 项目根天然在表内；预览根按窗口生命周期登记 / 上翻替换 / 关窗撤销。
 */

/** owner（BrowserWindow id）→ 规范化根 */
const grantedByOwner = new Map<number, string>()

export function grantFilesRoot(owner: number, root: string): void {
  grantedByOwner.set(owner, normalizePath(root))
}

export function revokeFilesRoot(owner: number): void {
  grantedByOwner.delete(owner)
}

export function isGrantedFilesRoot(root: string): boolean {
  const logical = normalizePath(root)
  if (getProjects().some((p) => normalizePath(p.path) === logical)) return true
  for (const granted of grantedByOwner.values()) {
    if (granted === logical) return true
  }
  return false
}

/** 绝对路径是否落在任一授权根之内（含根自身）；「在其他应用中打开 / 在文件夹中显示」用。 */
export function isPathUnderGrantedRoot(path: string): boolean {
  const logical = normalizePath(path)
  const roots = [...getProjects().map((p) => normalizePath(p.path)), ...grantedByOwner.values()]
  return roots.some((root) => logical === root || logical.startsWith(root + '/'))
}
