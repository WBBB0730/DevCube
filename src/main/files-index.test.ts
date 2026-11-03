// 文件名索引集成测试：spawn 真实 rg 打临时目录，验证顺着符号链接列（ADR-0059）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getFilesIndex, invalidateFilesIndex } from './files-index'

let base = ''
let project = ''

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'devcube-files-index-'))
  project = path.join(base, 'project')
  await mkdir(path.join(project, 'real'), { recursive: true })
  await writeFile(path.join(project, 'real', 'a.txt'), 'a')
  await mkdir(path.join(base, 'outside'))
  await writeFile(path.join(base, 'outside', 'far.txt'), 'far')
  if (process.platform === 'win32') return
  await symlink('real', path.join(project, 'to-dir'))
  await symlink('real/a.txt', path.join(project, 'to-file'))
  await symlink('../outside', path.join(project, 'link-out'))
  await symlink('missing', path.join(project, 'dangling'))
  await symlink('.', path.join(project, 'loop'))
})

afterAll(async () => {
  invalidateFilesIndex(project)
  await rm(base, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('getFilesIndex 与符号链接（真实 rg 进程）', () => {
  it('链接文件与链接文件夹里的文件都在名单里（含指向项目外的），断链与循环链接不让索引失败', async () => {
    expect([...(await getFilesIndex(project))].sort()).toEqual([
      'link-out/far.txt',
      'real/a.txt',
      'to-dir/a.txt',
      'to-file'
    ])
  })
})
