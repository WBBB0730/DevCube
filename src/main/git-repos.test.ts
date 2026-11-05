// git-repos 测试：项目里的仓库怎么发现（真实 git，登录 shell 环境替换成空的，git 从当前 PATH 里找）。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetProjectRepos,
  getProjectRepos,
  getWatchedRepos,
  isFullyDiscovered,
  orphanedRepoPaths,
  parseNestedRepoEntries,
  parseSubmodulePaths,
  revalidateOwnRepo,
  revalidateProjectRepos
} from './git-repos'

vi.mock('./wsl', () => ({ wslExec: vi.fn() }))
vi.mock('./shell-env', () => ({ resolveShellEnvironment: async () => ({}) }))

/** 搭测试仓库用：在 cwd 里跑一条真实 git，失败即断言失败。 */
function git(cwd: string, args: string[]): void {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args],
    { cwd }
  )
  expect(r.status, r.stderr?.toString()).toBe(0)
}

/** 建一个有一次提交的仓库。 */
function makeRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-q'])
  writeFileSync(join(dir, 'f.txt'), 'x\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
}

let base: string
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'devcube-git-repos-')))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

async function reposOf(projectPath: string): Promise<Array<[string, boolean, string | null]>> {
  forgetProjectRepos(projectPath)
  const repos = await getProjectRepos(projectPath)
  return repos.map((r) => [r.name, r.own, r.superPath === null ? null : r.superPath])
}

describe('输出解析', () => {
  it('ls-files --others：只取以 / 结尾的条目', () => {
    expect(parseNestedRepoEntries('a.txt\0inner/\0deep/x/\0b/c.txt\0')).toEqual(['inner', 'deep/x'])
    expect(parseNestedRepoEntries('')).toEqual([])
  })
  it('.gitmodules 的 path 值', () => {
    expect(
      parseSubmodulePaths('submodule.lib.path\nlib\0submodule.a b.path\nvendor/a b\0')
    ).toEqual(['lib', 'vendor/a b'])
  })
})

describe('项目移除后没人再用的仓库键', () => {
  it('在移除的项目目录里、又不在剩下的项目目录里', () => {
    const p = (...segments: string[]): string => join(base, ...segments)
    expect(
      orphanedRepoPaths(
        [p('code'), p('code', 'lib'), p('code', 'app'), p('code', 'app', 'x'), p('codes'), p('q')],
        p('code'),
        [p('code', 'app'), p('q')]
      )
    ).toEqual([p('code'), p('code', 'lib')])
  })
  it('移除的项目是剩下项目里的嵌套仓库：留着（同一个仓库共用设置）', () => {
    const p = (...segments: string[]): string => join(base, ...segments)
    expect(orphanedRepoPaths([p('q', 'sub'), p('q')], p('q', 'sub'), [p('q')])).toEqual([])
  })
})

// 每个用例要搭好几个真实仓库、跑几十个 git 进程，和别的测试文件并行时远超默认的 5 秒
describe('发现', { timeout: 30_000 }, () => {
  it('项目是仓库，里面套着嵌套仓库（含没有提交的、深层的、普通目录里的）', async () => {
    const project = join(base, 'outer')
    makeRepo(project)
    makeRepo(join(project, 'b-inner'))
    mkdirSync(join(project, 'empty-inner'))
    git(join(project, 'empty-inner'), ['init', '-q'])
    makeRepo(join(project, 'deep', 'dir', 'inner'))
    makeRepo(join(project, 'b-inner', 'nested'))
    expect(await reposOf(project)).toEqual([
      ['outer', true, null],
      ['b-inner', false, null],
      ['b-inner/nested', false, null],
      ['deep/dir/inner', false, null],
      ['empty-inner', false, null]
    ])
  })

  it('被忽略的、隐藏目录里的、node_modules 里的嵌套仓库不算', async () => {
    const project = join(base, 'outer')
    makeRepo(project)
    writeFileSync(join(project, '.gitignore'), 'ignored/\n')
    makeRepo(join(project, 'ignored', 'repo'))
    makeRepo(join(project, '.cache', 'repo'))
    makeRepo(join(project, 'node_modules', 'pkg'))
    makeRepo(join(project, 'kept'))
    expect(await reposOf(project)).toEqual([
      ['outer', true, null],
      ['kept', false, null]
    ])
  })

  it('项目不是仓库：逐层找到各处的仓库，跳过隐藏目录与 node_modules', async () => {
    const project = join(base, 'code')
    makeRepo(join(project, 'app'))
    makeRepo(join(project, 'group', 'lib'))
    makeRepo(join(project, 'app', 'inner'))
    makeRepo(join(project, '.hidden', 'repo'))
    makeRepo(join(project, 'node_modules', 'pkg'))
    mkdirSync(join(project, 'plain', 'deeper'), { recursive: true })
    expect(await reposOf(project)).toEqual([
      ['app', false, null],
      ['app/inner', false, null],
      ['group/lib', false, null]
    ])
  })

  it('子模块：已检出的才算，记下上级仓库', async () => {
    const remote = join(base, 'remote-lib')
    makeRepo(remote)
    const project = join(base, 'sup')
    makeRepo(project)
    git(project, ['submodule', 'add', '-q', remote, 'libs/lib'])
    git(project, ['commit', '-q', '-m', 'add submodule'])
    const repos = await getProjectRepos(project)
    expect(repos.map((r) => [r.name, r.superPath])).toEqual([
      ['sup', null],
      ['libs/lib', project]
    ])
    // 子模块的 gitdir 在上级的 .git/modules 里
    expect(repos[1].gitDirs?.gitDir).toBe(join(project, '.git', 'modules', 'libs', 'lib'))
  })

  it('项目是上层仓库的子目录：认上层仓库，只找项目里面的嵌套仓库', async () => {
    const mono = join(base, 'mono')
    makeRepo(mono)
    const project = join(mono, 'app')
    mkdirSync(project)
    writeFileSync(join(project, 'a.txt'), 'a\n')
    makeRepo(join(project, 'inner'))
    makeRepo(join(mono, 'other'))
    const repos = await getProjectRepos(project)
    expect(repos.map((r) => [r.name, r.own, r.path, r.root])).toEqual([
      ['mono', true, project, mono],
      ['inner', false, join(project, 'inner'), join(project, 'inner')]
    ])
  })

  it('项目目录被上层仓库忽略（家目录做成仓库、里面全忽略）：不认上层仓库', async () => {
    const home = join(base, 'home')
    makeRepo(home)
    writeFileSync(join(home, '.gitignore'), '*\n!.gitignore\n')
    git(home, ['add', '.gitignore'])
    git(home, ['commit', '-q', '-m', 'ignore all'])
    const project = join(home, 'code')
    makeRepo(join(project, 'app'))
    expect(await reposOf(project)).toEqual([['app', false, null]])
  })

  it('重新发现：新建的仓库算变化，没变时不算', async () => {
    const project = join(base, 'code')
    makeRepo(join(project, 'a'))
    forgetProjectRepos(project)
    expect((await revalidateProjectRepos(project)).changed).toBe(true)
    expect((await revalidateProjectRepos(project)).changed).toBe(false)
    makeRepo(join(project, 'b'))
    const { repos, changed } = await revalidateProjectRepos(project)
    expect(changed).toBe(true)
    expect(repos.map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('只重查项目根：根没变时不重新发现（新的嵌套仓库交给监听），项目根 init 后整个重新发现', async () => {
    const project = join(base, 'code')
    makeRepo(join(project, 'a'))
    forgetProjectRepos(project)
    await getProjectRepos(project)
    makeRepo(join(project, 'b'))
    expect((await revalidateOwnRepo(project)).changed).toBe(false)
    git(project, ['init', '-q'])
    const { repos, changed } = await revalidateOwnRepo(project)
    expect(changed).toBe(true)
    expect(repos.map((r) => [r.name, r.own])).toEqual([
      ['code', true],
      ['a', false],
      ['b', false]
    ])
  })

  it('监听用的清单：没打开过的项目只查它自己的仓库，重新发现也只重查项目根；要过清单后才有嵌套仓库', async () => {
    const project = join(base, 'code')
    makeRepo(join(project, 'a'))
    forgetProjectRepos(project)
    expect(await getWatchedRepos(project)).toEqual([])
    expect(isFullyDiscovered(project)).toBe(false)
    makeRepo(join(project, 'b'))
    expect(await revalidateProjectRepos(project)).toEqual({ repos: [], changed: false })
    git(project, ['init', '-q'])
    const { repos, changed } = await revalidateProjectRepos(project)
    expect(changed).toBe(true)
    expect(repos.map((r) => r.name)).toEqual(['code'])
    expect(isFullyDiscovered(project)).toBe(false)
    expect((await getProjectRepos(project)).map((r) => r.name)).toEqual(['code', 'a', 'b'])
    expect(isFullyDiscovered(project)).toBe(true)
    expect((await getWatchedRepos(project)).map((r) => r.name)).toEqual(['code', 'a', 'b'])
  })

  it('子模块没检出时不算', async () => {
    const remote = join(base, 'remote-lib')
    makeRepo(remote)
    const source = join(base, 'source')
    makeRepo(source)
    git(source, ['submodule', 'add', '-q', remote, 'lib'])
    git(source, ['commit', '-q', '-m', 'add submodule'])
    // 不带 --recurse-submodules 克隆：.gitmodules 在，子模块目录是空的
    git(base, ['clone', '-q', source, 'clone'])
    expect(await reposOf(join(base, 'clone'))).toEqual([['clone', true, null]])
  })
})
