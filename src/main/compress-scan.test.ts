import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  filterCompressEntries,
  previewOf,
  scanCompressItems,
  type CompressScanDeps
} from './compress-scan'

// 在临时目录里搭真实的仓库现场，用本机 git 判定；隔离用户的全局 / 系统配置（含全局忽略规则）。
let root: string
let gitEnv: NodeJS.ProcessEnv

function git(cwd: string, args: string[], input?: Buffer): ReturnType<typeof spawnSync> {
  return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    env: gitEnv,
    input
  })
}

const deps: CompressScanDeps = {
  gitAvailable: async () => true,
  git: async (cwd, args, input) => {
    const r = git(cwd, args, input)
    return { code: r.status ?? -1, stdout: r.stdout as Buffer, message: String(r.stderr) }
  }
}

// Mac 生成的文件真实的文件头（取自本机 Finder 生成的文件）
const DS_STORE_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31])
const APPLE_DOUBLE_HEADER = Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00])

function write(path: string, content: string | Buffer = 'x'): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function names(entries: { name: string }[]): string[] {
  return entries.map((e) => e.name).sort()
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'devcube-compress-scan-'))
  const home = join(root, 'home')
  mkdirSync(home)
  gitEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1'
  }
  writeFileSync(join(home, 'gitconfig'), '')

  // 仓库 web：忽略 node_modules/、*.log、build/；build 里强制提交了一个文件
  const web = join(root, 'w', 'web')
  write(join(web, '.gitignore'), 'node_modules/\n*.log\nbuild/\n')
  write(join(web, 'src', 'a.ts'))
  write(join(web, 'node_modules', 'pkg', 'index.js'))
  write(join(web, 'debug.log'))
  write(join(web, 'build', 'keep.txt'))
  write(join(web, 'build', 'out.js'))
  write(join(web, 'notes.md'))
  write(join(web, '.DS_Store'), DS_STORE_HEADER)
  write(join(web, '._a.ts'), APPLE_DOUBLE_HEADER)
  // 名字像、内容不是 Mac 生成的普通文件
  write(join(web, '._notes.txt'), 'plain')
  mkdirSync(join(web, 'empty', 'deeper'), { recursive: true })
  git(web, ['init', '-q'])
  git(web, ['add', '.gitignore', 'src/a.ts'])
  git(web, ['add', '-f', 'build/keep.txt'])
  git(web, ['commit', '-q', '-m', 'init'])
  // 未跟踪的嵌套仓库，有自己的忽略规则
  const inner = join(web, 'inner')
  write(join(inner, '.gitignore'), 'secret.txt\n')
  write(join(inner, 'lib.ts'))
  write(join(inner, 'secret.txt'))
  git(inner, ['init', '-q'])

  // 整个未跟踪的新文件夹：里面有空文件夹，也有被忽略的 node_modules
  write(join(web, 'fresh', 'index.ts'))
  write(join(web, 'fresh', 'node_modules', 'dep', 'a.js'))
  mkdirSync(join(web, 'fresh', 'node_modules', 'dep', 'deep'), { recursive: true })
  mkdirSync(join(web, 'fresh', 'blank'), { recursive: true })

  // 不是仓库的文件夹：里面的 .gitignore 不起作用
  const plain = join(root, 'w', 'plain')
  write(join(plain, '.gitignore'), '*.txt\n')
  write(join(plain, 'a.txt'))
  write(join(plain, '__MACOSX', '._a.txt'))

  // 仓库里只有 __MACOSX 这一种 Mac 专属文件（git 只列出它里面的文件，文件夹本身由路径补齐）
  const unzipped = join(root, 'w', 'unzipped')
  write(join(unzipped, 'a.txt'))
  write(join(unzipped, '__MACOSX', '._a.txt'))
  git(unzipped, ['init', '-q'])
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('scanCompressItems', () => {
  it('仓库里按 Git 的规则列出：忽略的排除、已跟踪的保留、嵌套仓库按自己的规则、空文件夹保留', async () => {
    const web = join(root, 'w', 'web')
    const { entries, flags } = await scanCompressItems(
      [web],
      join(root, 'w'),
      true,
      undefined,
      deps
    )
    const listed = names(entries).filter((n) => !n.includes('/.git/'))
    expect(listed).toEqual([
      'web',
      'web/.DS_Store',
      'web/._a.ts',
      'web/._notes.txt',
      'web/.git',
      'web/.gitignore',
      'web/build',
      'web/build/keep.txt',
      'web/empty',
      'web/empty/deeper',
      'web/fresh',
      'web/fresh/blank',
      'web/fresh/index.ts',
      'web/inner',
      'web/inner/.git',
      'web/inner/.gitignore',
      'web/inner/lib.ts',
      'web/notes.md',
      'web/src',
      'web/src/a.ts'
    ])
    expect(flags).toEqual({ hasRepo: true, hasDotGit: true, hasMacJunk: true })
    // 每个条目只出现一次（目录不会因空文件夹判定被重复加入）
    expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length)
  })

  it('不排除时遍历磁盘，全部装入', async () => {
    const web = join(root, 'w', 'web')
    const { entries } = await scanCompressItems([web], join(root, 'w'), false, undefined, deps)
    const listed = names(entries)
    expect(listed).toContain('web/node_modules/pkg/index.js')
    expect(listed).toContain('web/debug.log')
    expect(listed).toContain('web/inner/secret.txt')
  })

  it('勾选在内存里过滤：.git 与 Mac 专属文件；预览只数文件', async () => {
    const web = join(root, 'w', 'web')
    const { entries } = await scanCompressItems([web], join(root, 'w'), true, undefined, deps)
    const kept = filterCompressEntries(entries, { excludeGit: true, excludeMacJunk: true })
    expect(names(kept).some((n) => n.includes('.git/') || n.endsWith('/.git'))).toBe(false)
    expect(names(kept)).not.toContain('web/.DS_Store')
    expect(names(kept)).not.toContain('web/._a.ts')
    // 文件头不是 Mac 生成的 ._ 文件照常装
    expect(names(kept)).toContain('web/._notes.txt')
    // 5 个 1 字节的文件 + 两份 .gitignore（27 + 11 字节）+ ._notes.txt（5 字节）
    expect(previewOf(kept)).toEqual({ files: 8, bytes: 48 })
  })

  it('只选一个 Mac 专属文件时，它本身照常装（明确选了它）', async () => {
    const web = join(root, 'w', 'web')
    const { entries, flags } = await scanCompressItems(
      [join(web, '.DS_Store')],
      web,
      true,
      undefined,
      deps
    )
    expect(entries.map((e) => [e.name, e.macJunk])).toEqual([['.DS_Store', false]])
    expect(flags.hasMacJunk).toBe(false)
  })

  it('仓库外的 .gitignore 不起作用；所选条目以外的 __MACOSX 整支标记', async () => {
    const plain = join(root, 'w', 'plain')
    const { entries, flags } = await scanCompressItems(
      [plain],
      join(root, 'w'),
      true,
      undefined,
      deps
    )
    expect(flags).toEqual({ hasRepo: false, hasDotGit: false, hasMacJunk: true })
    expect(names(entries)).toContain('plain/a.txt')
    expect(
      names(filterCompressEntries(entries, { excludeGit: false, excludeMacJunk: true }))
    ).toEqual(['plain', 'plain/.gitignore', 'plain/a.txt'])
  })

  it('仓库里由 git 列出的 __MACOSX 同样记为内容里有 Mac 专属文件', async () => {
    const unzipped = join(root, 'w', 'unzipped')
    const { entries, flags } = await scanCompressItems(
      [unzipped],
      join(root, 'w'),
      true,
      undefined,
      deps
    )
    expect(flags.hasMacJunk).toBe(true)
    expect(
      names(filterCompressEntries(entries, { excludeGit: true, excludeMacJunk: true }))
    ).toEqual(['unzipped', 'unzipped/a.txt'])
  })

  it('仓库的子文件夹：上层的忽略规则照样生效，包内路径相对共同上层', async () => {
    const web = join(root, 'w', 'web')
    const { entries } = await scanCompressItems(
      [join(web, 'build'), join(web, 'src')],
      web,
      true,
      undefined,
      deps
    )
    expect(names(entries)).toEqual(['build', 'build/keep.txt', 'src', 'src/a.ts'])
  })

  it('多选（全选仓库根目录的内容）：所选条目本身也按规则处理', async () => {
    const web = join(root, 'w', 'web')
    const items = readdirSync(web).map((n) => join(web, n))
    const { entries, flags } = await scanCompressItems(items, web, true, undefined, deps)
    const listed = names(entries)
    expect(flags).toEqual({ hasRepo: true, hasDotGit: true, hasMacJunk: true })
    // .git 与 .DS_Store 只做标记，由勾选决定去留
    expect(entries.find((e) => e.name === '.git')?.inGit).toBe(true)
    expect(entries.find((e) => e.name === '.DS_Store')?.macJunk).toBe(true)
    expect(entries.find((e) => e.name === '._a.ts')?.macJunk).toBe(true)
    expect(entries.find((e) => e.name === '._notes.txt')?.macJunk).toBe(false)
    // 被忽略的条目本身不装：node_modules、debug.log；被忽略的 build 里强制提交的文件照样装
    expect(listed).not.toContain('node_modules')
    expect(listed).not.toContain('debug.log')
    expect(listed).not.toContain('build/out.js')
    expect(listed).toContain('build/keep.txt')
    // 空文件夹、整个未跟踪的新文件夹、嵌套仓库照常
    expect(listed).toEqual(expect.arrayContaining(['empty/deeper', 'fresh/blank', 'inner/lib.ts']))
    expect(listed).not.toContain('fresh/node_modules')
    expect(listed).not.toContain('inner/secret.txt')
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('多选且不排除忽略的文件：全部装入，所选的 .git 同样可按勾选排除', async () => {
    const web = join(root, 'w', 'web')
    const items = readdirSync(web).map((n) => join(web, n))
    const { entries, flags } = await scanCompressItems(items, web, false, undefined, deps)
    expect(flags.hasDotGit).toBe(true)
    expect(names(entries)).toContain('node_modules/pkg/index.js')
    const kept = filterCompressEntries(entries, { excludeGit: true, excludeMacJunk: false })
    expect(names(kept).some((n) => n === '.git' || n.startsWith('.git/'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('符号链接作为链接条目，不跟随', async () => {
    const dir = join(root, 'links')
    write(join(dir, 'real', 'a.txt'))
    symlinkSync('real', join(dir, 'to-dir'))
    symlinkSync('real/a.txt', join(dir, 'to-file'))
    const { entries } = await scanCompressItems([dir], root, false, undefined, deps)
    const links = entries.filter((e) => e.kind === 'link')
    expect(links.map((e) => [e.name, e.target]).sort()).toEqual([
      ['links/to-dir', 'real'],
      ['links/to-file', 'real/a.txt']
    ])
  })

  it('中途取消即抛出', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      scanCompressItems([join(root, 'w')], root, true, controller.signal, deps)
    ).rejects.toThrow('已取消')
  })
})
