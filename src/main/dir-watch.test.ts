// 目录监听集成测试：真实 @parcel/watcher 订阅临时目录（Windows 建链接要权限，跳过）。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { subscribeDir } from './dir-watch'

let base = ''

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'devcube-dir-watch-'))
  mkdirSync(join(base, 'real'))
  if (process.platform !== 'win32') symlinkSync('real', join(base, 'alias'))
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('subscribeDir', () => {
  it('经符号链接订阅时，事件路径换回订阅时的写法（macOS 的 FSEvents 报回真实路径，ADR-0059）', async () => {
    const alias = join(base, 'alias')
    const paths: string[] = []
    const sub = await subscribeDir(alias, (_err, events) => {
      paths.push(...events.map((event) => event.path))
    })
    try {
      writeFileSync(join(alias, 'x.txt'), 'x')
      await vi.waitFor(() => expect(paths).toContain(join(alias, 'x.txt')), { timeout: 5000 })
      expect(paths.every((path) => path === alias || path.startsWith(alias + sep))).toBe(true)
    } finally {
      await sub.unsubscribe()
    }
  })
})
