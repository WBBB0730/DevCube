import { normalizePath } from './files-path'

/**
 * Preview Window（预览窗口）的纯逻辑（docs/prd/file-preview-window.md）：
 * 根解析、上翻、以及主进程 ↔ 渲染层之间用 URL 查询串传递的启动参数。
 */

export const PREVIEW_QUERY_MODE = 'preview'

export interface PreviewLaunch {
  /** 初始打开的文件（规范化逻辑路径）；主窗口「在新窗口中打开」项目时无文件为 null */
  file: string | null
  /** 树的初始根（规范化逻辑路径） */
  root: string
}

/** 父目录；已到文件系统根（`/` 或 `C:/`）时 null。 */
export function parentLogicalPath(logical: string): string | null {
  const p = normalizePath(logical)
  if (p === '/' || /^[A-Z]:\/$/.test(p)) return null
  const slash = p.lastIndexOf('/')
  if (slash < 0) return null
  if (slash === 0) return '/'
  const parent = p.slice(0, slash)
  // Windows 盘符根：`C:` → `C:/`
  return /^[A-Z]:$/.test(parent) ? parent + '/' : parent
}

/**
 * 初始根：文件落在某个已登记 Project 根之内取最深匹配的项目根，否则取文件所在文件夹。
 */
export function resolvePreviewRoot(fileLogical: string, projectPaths: readonly string[]): string {
  const file = normalizePath(fileLogical)
  let best: string | null = null
  for (const raw of projectPaths) {
    const root = normalizePath(raw)
    if (file.startsWith(root + '/') && (best === null || root.length > best.length)) best = root
  }
  return best ?? parentLogicalPath(file) ?? file
}

export function buildPreviewQuery(launch: PreviewLaunch): Record<string, string> {
  return {
    mode: PREVIEW_QUERY_MODE,
    root: launch.root,
    ...(launch.file === null ? {} : { file: launch.file })
  }
}

/** 渲染层从 `location.search` 解析；非预览模式或缺根为 null。 */
export function parsePreviewLaunch(search: string): PreviewLaunch | null {
  const params = new URLSearchParams(search)
  if (params.get('mode') !== PREVIEW_QUERY_MODE) return null
  const file = params.get('file')
  const root = params.get('root')
  if (!root) return null
  return { file: file ? normalizePath(file) : null, root: normalizePath(root) }
}
