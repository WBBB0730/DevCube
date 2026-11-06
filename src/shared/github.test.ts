import { describe, expect, it } from 'vitest'
import { defaultGitHubRepoName, gitHubRepoNameError, gitHubRepoUrl } from './github'

describe('gitHubRepoUrl', () => {
  it('按地址形式取地址', () => {
    const repo = {
      fullName: 'owner/repo',
      httpsUrl: 'https://github.com/owner/repo.git',
      sshUrl: 'git@github.com:owner/repo.git'
    }
    expect(gitHubRepoUrl(repo, 'https')).toBe(repo.httpsUrl)
    expect(gitHubRepoUrl(repo, 'ssh')).toBe(repo.sshUrl)
  })
})

describe('gitHubRepoNameError', () => {
  it('字母、数字与 . - _ 合法', () => {
    expect(gitHubRepoNameError('my-repo_1.0')).toBeNull()
  })

  it('空、超长、含其他字符、. 与 .. 不合法', () => {
    expect(gitHubRepoNameError('')).toBe('请输入仓库名')
    expect(gitHubRepoNameError('a'.repeat(101))).toBe('仓库名不能超过 100 个字符')
    expect(gitHubRepoNameError('my repo')).toBe('仓库名只能包含字母、数字与 . - _')
    expect(gitHubRepoNameError('项目')).toBe('仓库名只能包含字母、数字与 . - _')
    expect(gitHubRepoNameError('.')).toBe('仓库名不能是 . 或 ..')
    expect(gitHubRepoNameError('..')).toBe('仓库名不能是 . 或 ..')
  })
})

describe('defaultGitHubRepoName', () => {
  it('不收的字符换成 -，连续的并成一个', () => {
    expect(defaultGitHubRepoName('my-repo')).toBe('my-repo')
    expect(defaultGitHubRepoName('My Project (copy)')).toBe('My-Project-copy-')
    expect(defaultGitHubRepoName('  repo  ')).toBe('repo')
  })

  it('截到 100 个字符', () => {
    expect(defaultGitHubRepoName('a'.repeat(120))).toHaveLength(100)
  })
})
