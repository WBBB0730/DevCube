/**
 * 把候选路径限制在项目根内：成功返回规范化绝对路径，越界 / 空则 null。
 * 纯解析（不访问磁盘）；不依赖 node:path，main / renderer 均可导入。
 */

function split(p: string): string[] {
  return p.split(/[/\\]+/).filter((s) => s.length > 0)
}

/** 是否为 Windows 盘符绝对路径（如 C:\ 或 C:/）。 */
function isWinAbs(p: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(p)
}

function isAbs(p: string): boolean {
  return p.startsWith('/') || isWinAbs(p)
}

/**
 * 规范化路径段（处理 . / ..），保留 Windows 盘符或 POSIX 根。
 * 输出统一用 `/`（仅作逻辑比较与 IPC；落盘 IO 由主进程再转系统分隔符）。
 */
export function normalizePath(p: string): string {
  const win = isWinAbs(p)
  const drive = win ? p.slice(0, 2).toUpperCase() : ''
  const abs = isAbs(p)
  const parts = split(win ? p.slice(2) : p)
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  if (win) return drive + '/' + out.join('/')
  if (abs) return '/' + out.join('/')
  return out.join('/')
}

/** 根下子路径的公共前缀：根本身以 `/` 结尾（`/`、`C:/`）时不再补一个。 */
export function childPathPrefix(root: string): string {
  return root.endsWith('/') ? root : root + '/'
}

/** 在目录下拼出子路径（纯拼接，不规范化：服务器上的文件名可能含 `\`）。 */
export function joinLogicalPath(dir: string, name: string): string {
  return childPathPrefix(dir) + name
}

/** 所在目录（纯字符串运算）；`/x` → `/`，`C:/x` → `C:/`，根自身原样返回。 */
export function logicalParentPath(p: string): string {
  const slash = p.lastIndexOf('/')
  if (slash < 0) return p
  const withSlash = p.slice(0, slash + 1)
  return withSlash === '/' || /^[a-zA-Z]:\/$/.test(withSlash) ? withSlash : withSlash.slice(0, -1)
}

/** 路径末段（目录名或文件名）；兼容两种分隔符与末尾分隔符。 */
export function lastPathSegment(p: string): string {
  const segments = split(p)
  return segments[segments.length - 1] ?? p
}

/**
 * 前缀重映射（重命名后同步展开 / 打开 / 最近路径）：
 * p 等于 oldBase 或位于其内时替换前缀为 newBase，否则原样返回。
 */
export function remapPathPrefix(p: string, oldBase: string, newBase: string): string {
  if (p === oldBase) return newBase
  if (p.startsWith(oldBase + '/')) return newBase + p.slice(oldBase.length)
  return p
}

export function resolveWithinProject(projectRoot: string, candidate: string): string | null {
  if (!projectRoot || !candidate) return null
  const root = normalizePath(projectRoot)
  const resolved = isAbs(candidate)
    ? normalizePath(candidate)
    : normalizePath(root + '/' + candidate)
  if (resolved === root) return resolved
  const prefix = root.endsWith('/') ? root : root + '/'
  if (resolved.startsWith(prefix)) return resolved
  return null
}
