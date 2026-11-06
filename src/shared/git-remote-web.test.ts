import { describe, expect, it } from 'vitest'
import { parseRemoteLocation, remoteWebUrl } from './git-remote-web'

/** 不经别名解析直接换算；认不出为 null。 */
function web(url: string): string | null {
  const location = parseRemoteLocation(url)
  return location === null ? null : remoteWebUrl(location)
}

describe('remoteWebUrl', () => {
  it('https 地址剥 .git、末尾斜杠与认证信息', () => {
    expect(web('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(web('https://github.com/owner/repo/')).toBe('https://github.com/owner/repo')
    expect(web('https://user:token@gitlab.com/group/sub/repo.git')).toBe(
      'https://gitlab.com/group/sub/repo'
    )
  })

  it('http(s) 地址保留协议与端口', () => {
    expect(web('http://git.example.com:8080/team/repo.git')).toBe(
      'http://git.example.com:8080/team/repo'
    )
  })

  it('scp 形式换成 https，主机名转小写', () => {
    expect(web('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(web('git@Gitee.com:owner/repo')).toBe('https://gitee.com/owner/repo')
  })

  it('ssh / git 协议去掉端口换成 https', () => {
    expect(web('ssh://git@gitlab.example.com:2222/group/repo.git')).toBe(
      'https://gitlab.example.com/group/repo'
    )
    expect(web('git://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(web('git+ssh://git@github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
  })

  it('SSH 专用主机换成网页主机', () => {
    expect(web('ssh://git@ssh.github.com:443/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(web('git@altssh.gitlab.com:group/repo.git')).toBe('https://gitlab.com/group/repo')
  })

  it('Azure DevOps 的 SSH 地址换成它的网页路由，https 地址剥认证信息即可', () => {
    expect(web('git@ssh.dev.azure.com:v3/org/project/repo')).toBe(
      'https://dev.azure.com/org/project/_git/repo'
    )
    expect(web('https://org@dev.azure.com/org/project/_git/repo')).toBe(
      'https://dev.azure.com/org/project/_git/repo'
    )
  })

  it('ssh 地址用解出的真实主机名（别名换成 HostName）', () => {
    const location = parseRemoteLocation('github-work:owner/repo.git')
    expect(location).not.toBeNull()
    expect(remoteWebUrl(location!, 'github.com')).toBe('https://github.com/owner/repo')
    expect(remoteWebUrl(location!, 'ssh.github.com')).toBe('https://github.com/owner/repo')
  })

  it('本地路径、file 地址、服务器上的绝对路径与 ~ 路径认不出', () => {
    expect(web('/srv/git/repo.git')).toBeNull()
    expect(web('../repo')).toBeNull()
    expect(web('C:\\repos\\repo')).toBeNull()
    expect(web('C:/repos/repo')).toBeNull()
    expect(web('file:///srv/git/repo.git')).toBeNull()
    expect(web('user@server:/srv/git/repo.git')).toBeNull()
    expect(web('ssh://user@server/~user/repo.git')).toBeNull()
    expect(web('https://github.com/')).toBeNull()
    expect(web('')).toBeNull()
  })

  it('以 - 开头的主机不认（会被 ssh 当成选项）', () => {
    expect(web('-oProxyCommand=x:owner/repo')).toBeNull()
    expect(web('ssh://-oProxyCommand=x/owner/repo')).toBeNull()
  })
})
