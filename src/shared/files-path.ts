/**
 * 逻辑路径：统一用 `/` 分隔，仅作逻辑比较与 IPC，落盘 IO 由主进程再转系统路径。根有三种：
 * POSIX 的 `/`、Windows 盘符 `C:/`、Windows 网络路径（UNC）的 `//主机/共享`（WSL 发行版即 `//wsl.localhost/<发行版>`）。
 * 纯解析（不访问磁盘）；不依赖 node:path，main / renderer 均可导入。
 */
import { canonicalUncHost } from './wsl-path'

function split(p: string): string[] {
  return p.split(/[/\\]+/).filter((s) => s.length > 0)
}

/** 是否为 Windows 盘符绝对路径（如 C:\ 或 C:/）。 */
function isWinAbs(p: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(p)
}

/** UNC 路径（`\\主机\共享\…`，两种分隔符都认）：统一写法的根 `//主机/共享` 与其后的部分；不是 UNC 为 null。 */
function splitUncRoot(p: string): { root: string; rest: string } | null {
  const m = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)(.*)$/.exec(p)
  return m ? { root: `//${canonicalUncHost(m[1])}/${m[2]}`, rest: m[3] } : null
}

/** 是否为绝对路径：POSIX 根、盘符或 UNC。 */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\\\') || isWinAbs(p)
}

/**
 * 规范化路径段（处理 . / ..），`..` 不越过根；盘符转大写，UNC 主机名统一写法（见 wsl-path）。
 */
export function normalizePath(p: string): string {
  const unc = splitUncRoot(p)
  const win = unc === null && isWinAbs(p)
  const root =
    unc !== null ? unc.root : win ? p.slice(0, 2).toUpperCase() + '/' : isAbsolutePath(p) ? '/' : ''
  const parts = split(unc !== null ? unc.rest : win ? p.slice(2) : p)
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  if (unc !== null) return out.length > 0 ? root + '/' + out.join('/') : root
  return root + out.join('/')
}

/** 规范化逻辑路径的根（`/`、`C:/` 或 `//主机/共享`）；相对路径为 null。 */
function logicalRoot(p: string): string | null {
  const unc = /^\/\/[^/]+\/[^/]+/.exec(p)
  if (unc) return unc[0]
  if (/^[a-zA-Z]:\//.test(p)) return p.slice(0, 3)
  return p.startsWith('/') ? '/' : null
}

/** 是否为文件系统的根（`/`、`C:/` 或 `//主机/共享`）。 */
export function isLogicalRoot(p: string): boolean {
  return logicalRoot(p) === p
}

/** 根下子路径的公共前缀：根本身以 `/` 结尾（`/`、`C:/`）时不再补一个。 */
export function childPathPrefix(root: string): string {
  return root.endsWith('/') ? root : root + '/'
}

/** 在目录下拼出子路径（纯拼接，不规范化：服务器上的文件名可能含 `\`）。 */
export function joinLogicalPath(dir: string, name: string): string {
  return childPathPrefix(dir) + name
}

/** 所在目录（纯字符串运算）；`/x` → `/`，`C:/x` → `C:/`，`//主机/共享/x` → `//主机/共享`，根自身原样返回。 */
export function logicalParentPath(p: string): string {
  const root = logicalRoot(p)
  if (root === p) return p
  const slash = p.lastIndexOf('/')
  if (slash < 0) return p
  const parent = p.slice(0, slash)
  return root !== null && parent.length < root.length ? root : parent
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

/** 把候选路径限制在项目根内：成功返回规范化绝对路径，越界 / 空则 null。 */
export function resolveWithinProject(projectRoot: string, candidate: string): string | null {
  if (!projectRoot || !candidate) return null
  const root = normalizePath(projectRoot)
  const resolved = isAbsolutePath(candidate)
    ? normalizePath(candidate)
    : normalizePath(root + '/' + candidate)
  if (resolved === root) return resolved
  if (resolved.startsWith(childPathPrefix(root))) return resolved
  return null
}
