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
