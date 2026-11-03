// 本机 Files 的符号链接处理：临时目录里造出文件链接、文件夹链接、断链、循环链接（Windows 建链接要权限，跳过）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizePath } from '../shared/files-path'
import {
  filesRootAlias,
  isSymlinkPath,
  realSelfOrInside,
  statTarget,
  symlinkEntry
} from './files-symlink'

let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'devcube-files-symlink-'))
  mkdirSync(join(dir, 'real'))
  writeFileSync(join(dir, 'real', 'a.txt'), 'a')
  if (process.platform === 'win32') return
  symlinkSync('real', join(dir, 'to-dir'))
  symlinkSync('real/a.txt', join(dir, 'to-file'))
  symlinkSync('missing', join(dir, 'dangling'))
  symlinkSync('loop-b', join(dir, 'loop-a'))
  symlinkSync('loop-a', join(dir, 'loop-b'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const logical = (name: string): string => normalizePath(join(dir, name))

describe.skipIf(process.platform === 'win32')('symlinkEntry', () => {
  it('指向文件夹的链接是文件夹，指向取目标的真实路径', async () => {
    expect(await symlinkEntry('to-dir', logical('to-dir'), null)).toEqual({
      name: 'to-dir',
      path: logical('to-dir'),
      isDirectory: true,
      symlink: { target: normalizePath(realpathSync(join(dir, 'real'))), broken: false }
    })
  })

  it('指向文件的链接是文件', async () => {
    const entry = await symlinkEntry('to-file', logical('to-file'), null)
    expect(entry.isDirectory).toBe(false)
    expect(entry.symlink).toEqual({
      target: normalizePath(realpathSync(join(dir, 'real', 'a.txt'))),
      broken: false
    })
  })

  it('根经过链接时，在根下的指向换回根的写法（与树上的路径一致）', async () => {
    const aliasRoot = join(dir, 'alias-root')
    symlinkSync(dir, aliasRoot)
    const root = normalizePath(aliasRoot)
    const alias = await filesRootAlias(root)
    expect(alias).toEqual({ logical: root, real: normalizePath(realpathSync(dir)) })
    const entry = await symlinkEntry('to-dir', `${root}/to-dir`, alias)
    expect(entry.symlink).toEqual({ target: `${root}/real`, broken: false })
  })

  it('根没经过链接时没有别名', async () => {
    const real = normalizePath(realpathSync(dir))
    expect(await filesRootAlias(real)).toBeNull()
  })

  it('断链与绕成圈的链接都是断链，指向取链接里写的原文', async () => {
    expect((await symlinkEntry('dangling', logical('dangling'), null)).symlink).toEqual({
      target: 'missing',
      broken: true
    })
    const loop = await symlinkEntry('loop-a', logical('loop-a'), null)
    expect(loop.isDirectory).toBe(false)
    expect(loop.symlink).toEqual({ target: 'loop-b', broken: true })
  })
})

describe.skipIf(process.platform === 'win32')('statTarget', () => {
  it('跟随链接取目标的信息', async () => {
    expect((await statTarget(join(dir, 'to-dir'))).isDirectory()).toBe(true)
  })

  it('断链报「链接目标不存在」', async () => {
    await expect(statTarget(join(dir, 'dangling'))).rejects.toThrow('链接目标不存在')
  })

  it('不存在的普通路径原样报错', async () => {
    await expect(statTarget(join(dir, 'nothing'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(process.platform === 'win32')('isSymlinkPath', () => {
  it('只看条目本身，断链也算，不存在不算', async () => {
    expect(await isSymlinkPath(join(dir, 'to-file'))).toBe(true)
    expect(await isSymlinkPath(join(dir, 'dangling'))).toBe(true)
    expect(await isSymlinkPath(join(dir, 'real'))).toBe(false)
    expect(await isSymlinkPath(join(dir, 'nothing'))).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('realSelfOrInside', () => {
  it('经链接落到文件夹自己里面：是', async () => {
    expect(await realSelfOrInside(join(dir, 'real'), join(dir, 'to-dir'))).toBe(true)
  })

  it('移动 / 复制的是链接本身、或落点在别处：不是', async () => {
    expect(await realSelfOrInside(join(dir, 'to-dir'), join(dir, 'real'))).toBe(false)
    expect(await realSelfOrInside(join(dir, 'real'), dir)).toBe(false)
    expect(await realSelfOrInside(join(dir, 'real', 'a.txt'), join(dir, 'to-dir'))).toBe(false)
  })
})
