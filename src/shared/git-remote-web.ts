/**
 * 远程地址 → 仓库网页地址（Git Tab 工具栏「在浏览器中打开」；docs/prd/git-remote-github.md）。
 * 纯解析（不访问磁盘与网络、不依赖 node / electron），main / renderer 均可导入；SSH 主机别名由主进程先用
 * `ssh -G` 解出真实主机名再交给 remoteWebUrl。
 */

/** 远程地址里换算网页地址要用的部分。 */
export interface RemoteLocation {
  /** http(s) 地址原样保留协议与端口；ssh / git 协议与 scp 形式换成 https、去掉端口 */
  kind: 'http' | 'ssh'
  /** 小写主机名（ssh 时可能是 `~/.ssh/config` 里的别名） */
  host: string
  /** http(s) 地址的协议（`http:` / `https:`）；ssh 为 null */
  protocol: string | null
  /** http(s) 地址的端口；没写或 ssh 为空串 */
  port: string
  /** 仓库路径（不带首尾斜杠与末尾的 .git），如 `owner/repo` */
  path: string
}

/** 带 scheme 的地址。 */
const URL_WITH_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i

/**
 * scp 形式 [user@]host:path：冒号前没有斜杠。冒号后紧跟斜杠的是服务器上的绝对路径（自建的裸仓库），
 * 没有对应的网页，不认。
 */
const SCP_LIKE = /^(?:[^@/\\]+@)?([^:/\\]+):(?![/\\])(.+)$/

/** SSH 专用主机 → 网页主机（走 443 端口等专门给 SSH 用的入口）。 */
const SSH_WEB_HOSTS: Record<string, string> = {
  'ssh.github.com': 'github.com',
  'altssh.gitlab.com': 'gitlab.com',
  'altssh.bitbucket.org': 'bitbucket.org'
}

/** 剥掉仓库路径首尾的斜杠与末尾的 `.git`；剥完为空返回 null。 */
function repoPath(raw: string): string | null {
  const path = raw
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  return path === '' ? null : path
}

/**
 * 解析远程地址；认不出或不对应网页的（本地路径、file://、`~user` 形式与 scp 形式的绝对路径）为 null。
 * 认 http / https、ssh（含 git+ssh / ssh+git）、git 协议与 scp 形式；Windows 盘符路径（`C:\…`、`C:/…`）不算 scp 形式。
 */
export function parseRemoteLocation(url: string): RemoteLocation | null {
  const trimmed = url.trim()
  const scheme = URL_WITH_SCHEME.exec(trimmed)?.[1].toLowerCase()
  if (scheme !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    const path = repoPath(parsed.pathname)
    if (parsed.hostname === '' || parsed.hostname.startsWith('-')) return null
    if (path === null || path.startsWith('~')) return null
    const host = parsed.hostname.toLowerCase()
    if (scheme === 'http' || scheme === 'https') {
      return { kind: 'http', host, protocol: parsed.protocol, port: parsed.port, path }
    }
    if (['ssh', 'git+ssh', 'ssh+git', 'git'].includes(scheme)) {
      return { kind: 'ssh', host, protocol: null, port: '', path }
    }
    return null
  }
  const scp = SCP_LIKE.exec(trimmed)
  // 单个字母的「主机」是 Windows 盘符；以 - 开头的主机会被 ssh 当成选项（git 同样拒绝）
  if (scp === null || scp[1].length === 1 || scp[1].startsWith('-')) return null
  const path = repoPath(scp[2])
  if (path === null || path.startsWith('~')) return null
  return { kind: 'ssh', host: scp[1].toLowerCase(), protocol: null, port: '', path }
}

/**
 * 仓库网页地址。sshHostName：ssh 地址的主机经 `ssh -G` 解出的真实主机名（别名换成 HostName）；
 * 不给即用地址里的主机。Azure DevOps 的 SSH 地址（`ssh.dev.azure.com:v3/组织/项目/仓库`）换成它的网页路由。
 */
export function remoteWebUrl(location: RemoteLocation, sshHostName?: string): string {
  if (location.kind === 'http') {
    const port = location.port === '' ? '' : `:${location.port}`
    return `${location.protocol}//${location.host}${port}/${location.path}`
  }
  const host = (sshHostName ?? location.host).toLowerCase()
  if (host === 'ssh.dev.azure.com') {
    const azure = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(location.path)
    if (azure !== null) return `https://dev.azure.com/${azure[1]}/${azure[2]}/_git/${azure[3]}`
  }
  return `https://${SSH_WEB_HOSTS[host] ?? host}/${location.path}`
}
