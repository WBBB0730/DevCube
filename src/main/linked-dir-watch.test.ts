// 链接目录监听集成测试：真实 @parcel/watcher 订阅临时目录（ADR-0059；Windows 建链接要权限，跳过）。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DirWatchEvent } from './dir-watch'
import { LinkedDirWatches, hostLinkedDirs, noteListedDir } from './linked-dir-watch'

let base = ''
let project = ''
let outside = ''

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'devcube-linked-dir-watch-')))
  project = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(join(project, 'inner'), { recursive: true })
  mkdirSync(join(outside, 'sub'), { recursive: true })
  if (process.platform !== 'win32') symlinkSync('../outside', join(project, 'link-out'))
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(process.platform === 'win32')('LinkedDirWatches', () => {
  it('只为根监听范围以外的目录另起监听；释放后不再通知', async () => {
    const paths: string[] = []
    const watches = new LinkedDirWatches(Promise.resolve(project), (_err, events) => {
      paths.push(...events.map((event: DirWatchEvent) => event.path))
    })
    await watches.add(join(project, 'inner'), project)
    await watches.add(outside, project)
    await watches.add(join(outside, 'sub'), outside)

    writeFileSync(join(project, 'inner', 'y.txt'), 'y')
    writeFileSync(join(outside, 'sub', 'x.txt'), 'x')
    await vi.waitFor(() => expect(paths).toContain(join(outside, 'sub', 'x.txt')), {
      timeout: 5000
    })
    await sleep(300)
    expect(paths.some((path) => path.startsWith(project))).toBe(false)

    await watches.dispose()
    paths.length = 0
    writeFileSync(join(outside, 'z.txt'), 'z')
    await sleep(1000)
    expect(paths).toEqual([])
  })
})

describe.skipIf(process.platform === 'win32')('LinkedDirWatches 与循环链接', () => {
  it('指向自己上级的链接（所在的文件夹在目标里）不另起，免得把整个上级目录都盯上', async () => {
    const paths: string[] = []
    const watches = new LinkedDirWatches(Promise.resolve(project), (_err, events) => {
      paths.push(...events.map((event: DirWatchEvent) => event.path))
    })
    // project/up → ..：目标是 base，链接所在的 project 就在 base 里
    await watches.add(base, project)
    writeFileSync(join(base, 'beside.txt'), 'b')
    await sleep(1000)
    expect(paths).toEqual([])
    await watches.dispose()
  })
})

describe.skipIf(process.platform === 'win32')('noteListedDir', () => {
  it('列了经链接进到项目以外的目录，交给以该 Files 根登记的宿主（按真实路径）', async () => {
    const added: string[] = []
    const host = {
      add: async (dir: string, parent: string) => void added.push(`${dir} ← ${parent}`)
    } as unknown as LinkedDirWatches
    const unhost = hostLinkedDirs(project, host)
    try {
      noteListedDir(project, join(project, 'link-out'))
      await vi.waitFor(() => expect(added).toEqual([`${outside} ← ${project}`]))
      noteListedDir(join(base, 'other-root'), join(project, 'link-out'))
      await sleep(100)
      expect(added).toEqual([`${outside} ← ${project}`])
    } finally {
      unhost()
    }
  })
})
