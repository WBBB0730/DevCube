/**
 * WSL 发行版里的路径（docs/prd/wsl-project.md）：`\\wsl.localhost\<发行版>\…` 与旧写法 `\\wsl$\<发行版>\…`，
 * 前缀不分大小写、两种分隔符都认。纯字符串运算，main / renderer 共用。
 */

const WSL_PREFIX = /^([/\\]{2})(?:wsl\$|wsl\.localhost)(?=[/\\])/i

/** WSL 路径的前缀统一写成 `wsl.localhost`（保留原分隔符）；其余路径原样返回。 */
export function canonicalWslPath(p: string): string {
  return p.replace(WSL_PREFIX, '$1wsl.localhost')
}

/** UNC 主机名的统一写法：WSL 的两种写法归一为 `wsl.localhost`，其余转小写（主机名不分大小写）。 */
export function canonicalUncHost(host: string): string {
  const lower = host.toLowerCase()
  return lower === 'wsl$' ? 'wsl.localhost' : lower
}

/** 路径所在的 WSL 发行版名（逻辑路径与系统路径都认）；不是 WSL 路径为 null。 */
export function wslDistroOf(p: string): string | null {
  return wslToLinuxPath(p)?.distro ?? null
}

/**
 * Linux 文件名里 NTFS 不允许的字符（控制字符与 `\ : * ? " < > |`），WSL 在 Windows 侧显示为私有区字符 U+F000 + 原码
 * （microsoft/WSL src/linux/init/escape.cpp）；两种路径互转时按同一规则转义、还原。
 */
function isNtfsInvalid(code: number): boolean {
  return (code >= 0x01 && code <= 0x1f) || '\\:*?"<>|'.includes(String.fromCharCode(code))
}

function unescapeSegment(segment: string): string {
  return segment.replace(/[\uF001-\uF07F]/g, (c) => {
    const original = c.charCodeAt(0) - 0xf000
    return isNtfsInvalid(original) ? String.fromCharCode(original) : c
  })
}

function escapeSegment(segment: string): string {
  return Array.from(segment, (c) =>
    isNtfsInvalid(c.charCodeAt(0)) ? String.fromCharCode(0xf000 + c.charCodeAt(0)) : c
  ).join('')
}

/** WSL 路径（逻辑或系统形式）→ 发行版名与发行版里的 Linux 路径；不是 WSL 路径为 null。 */
export function wslToLinuxPath(p: string): { distro: string; path: string } | null {
  const m = /^[/\\]{2}(?:wsl\$|wsl\.localhost)[/\\]+([^/\\]+)(.*)$/i.exec(p)
  if (!m) return null
  const segments = m[2]
    .split(/[/\\]+/)
    .filter((s) => s !== '')
    .map(unescapeSegment)
  return { distro: m[1], path: '/' + segments.join('/') }
}

/** 发行版里的 Linux 绝对路径 → Windows 侧的系统路径 `\\wsl.localhost\<发行版>\…`。 */
export function linuxToWslPath(distro: string, linuxPath: string): string {
  const segments = linuxPath
    .split('/')
    .filter((s) => s !== '')
    .map(escapeSegment)
  return ['\\\\wsl.localhost', distro, ...segments].join('\\')
}

/** 给用户复制的绝对路径：WSL 路径给发行版里的 Linux 路径（粘到终端里就能用，docs/prd/wsl-project.md），其余原样。 */
export function copyablePath(p: string): string {
  return wslToLinuxPath(p)?.path ?? p
}
