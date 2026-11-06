// 远程的仓库网页地址（Git Tab 工具栏「在浏览器中打开」；docs/prd/git-remote-github.md）。地址取 git 自己展开过
// insteadOf 的那个（`git remote get-url`），ssh 地址的主机经 `ssh -G` 解出真实主机名（`~/.ssh/config` 里的别名
// 换成 HostName），换算本身是 shared/git-remote-web 的纯函数。

import { parseRemoteLocation, remoteWebUrl } from '../shared/git-remote-web'
import { wslToLinuxPath } from '../shared/wsl-path'
import { execGit, resolveRepoRoot } from './git-exec'
import { resolveSsh, sshConfigOutput } from './ssh-connect'

/** ssh 连这个主机时实际连的主机名（与在终端里敲 ssh 一致）；没有 ssh 或解不出为 null。 */
async function sshHostName(host: string): Promise<string | null> {
  const { ssh, env } = await resolveSsh()
  if (ssh === null) return null
  try {
    return /^hostname (\S+)$/m.exec(await sshConfigOutput(ssh, env, [host]))?.[1] ?? null
  } catch {
    return null
  }
}

/** 远程的仓库网页地址；地址不对应网页（本地路径等）或读不到为 null。 */
export async function getRemoteWebUrl(repoPath: string, remote: string): Promise<string | null> {
  const root = await resolveRepoRoot(repoPath)
  if (root === null) return null
  const result = await execGit(root, ['remote', 'get-url', '--', remote])
  if (result.code !== 0) return null
  const location = parseRemoteLocation(result.stdout.toString('utf8'))
  if (location === null) return null
  // WSL 里的仓库由发行版里的 ssh 连接，本机的 ssh 配置解不了它的别名：照地址里的主机
  if (location.kind === 'http' || wslToLinuxPath(root) !== null) return remoteWebUrl(location)
  return remoteWebUrl(location, (await sshHostName(location.host)) ?? undefined)
}
