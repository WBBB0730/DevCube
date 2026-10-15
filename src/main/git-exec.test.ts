// git-exec 测试：链接工作树 → 主工作树目录的推导；WSL 仓库的分流与路径互转（发行版里的执行替换成假的）。
import { describe, expect, it, vi } from 'vitest'
import {
  execGit,
  execGitStreaming,
  findGit,
  gitOutputToLocal,
  gitPathArg,
  mainWorktreePathOf
} from './git-exec'
import { wslExec } from './wsl'

vi.mock('./wsl', () => ({ wslExec: vi.fn() }))

describe('mainWorktreePathOf', () => {
  it('链接工作树：公共 gitdir 名为 .git 时取其父目录', () => {
    expect(
      mainWorktreePathOf({
        gitDir: '/code/app/.git/worktrees/feat',
        commonDir: '/code/app/.git'
      })
    ).toBe('/code/app')
  })

  it('主工作树（两目录相同）为 null', () => {
    expect(mainWorktreePathOf({ gitDir: '/code/app/.git', commonDir: '/code/app/.git' })).toBeNull()
  })

  it('裸仓库的链接工作树（公共 gitdir 不叫 .git）为 null', () => {
    expect(
      mainWorktreePathOf({ gitDir: '/srv/repo.git/worktrees/wt', commonDir: '/srv/repo.git' })
    ).toBeNull()
  })
})

describe('WSL 仓库', () => {
  const root = '//wsl.localhost/Ubuntu/home/me/web'

  it('交给 git 的绝对路径换成发行版里的 Linux 路径；不在 WSL 里原样', () => {
    expect(gitPathArg(root, '\\\\wsl.localhost\\Ubuntu\\home\\me\\web.worktrees\\x')).toBe(
      '/home/me/web.worktrees/x'
    )
    expect(gitPathArg(root, root)).toBe('/home/me/web')
    expect(gitPathArg('C:/code/web', 'C:\\code\\wt')).toBe('C:\\code\\wt')
  })

  it('git 输出的 Linux 绝对路径换回本机路径；相对路径与不在 WSL 里原样', () => {
    expect(gitOutputToLocal(root, '/home/me/web/.git')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\web\\.git'
    )
    expect(gitOutputToLocal(root, '.git')).toBe('.git')
    expect(gitOutputToLocal('/Users/me/web', '/Users/me/web/.git')).toBe('/Users/me/web/.git')
  })

  it('在发行版里执行，带上应用内 git 的环境；找不到 git 时指明发行版', async () => {
    vi.mocked(wslExec).mockResolvedValueOnce({
      code: 0,
      stdout: Buffer.from('main\n'),
      stderr: Buffer.alloc(0),
      error: null
    })
    const ok = await execGit(root, ['branch', '--show-current'])
    expect(wslExec).toHaveBeenLastCalledWith('Ubuntu', 'git', ['branch', '--show-current'], {
      cwd: '/home/me/web',
      env: { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_OPTIONAL_LOCKS: '0' },
      input: undefined
    })
    expect(ok.stdout.toString()).toBe('main\n')

    vi.mocked(wslExec).mockResolvedValueOnce({
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      error: Object.assign(new Error('未找到 git'), { code: 'ENOENT' })
    })
    const missing = await execGit(root, ['status'])
    expect(missing.error?.message).toBe('Ubuntu 中未找到 git，请在其中安装')
  })

  it('按发行版发现 git；没找到不缓存', async () => {
    vi.mocked(wslExec).mockResolvedValueOnce({
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      error: Object.assign(new Error('未找到 git'), { code: 'ENOENT' })
    })
    expect(await findGit('//wsl.localhost/Debian/srv')).toBeNull()
    vi.mocked(wslExec).mockResolvedValueOnce({
      code: 0,
      stdout: Buffer.from('git version 2.43.0\n'),
      stderr: Buffer.alloc(0),
      error: null
    })
    expect(await findGit('//wsl.localhost/Debian/srv')).toEqual({ path: 'git', version: '2.43.0' })
    expect(await findGit('\\\\wsl.localhost\\debian\\other')).toEqual({
      path: 'git',
      version: '2.43.0'
    })
  })

  it('流式执行：stderr 按块回调，取消即在发行版里结束', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(wslExec).mockImplementationOnce(async (_distro, _file, _args, options) => {
      options.onData?.('stderr', Buffer.from('Receiving objects:  50%'))
      options.onData?.('stdout', Buffer.from('out'))
      signal = options.signal
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: null }
    })
    const chunks: string[] = []
    const run = await execGitStreaming(root, ['clone', 'x'], (chunk) => chunks.push(chunk))
    run.cancel()
    const result = await run.done
    expect(chunks).toEqual(['Receiving objects:  50%'])
    expect(result.stderr).toBe('Receiving objects:  50%')
    expect(result.stdout.toString()).toBe('out')
    expect(signal?.aborted).toBe(true)
  })
})
