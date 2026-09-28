import { describe, expect, it } from 'vitest'
import { ServerFileCopies, type ServerFileCopy } from './server-files-copies'

function setup(maxBytes = 100): {
  copies: ServerFileCopies<string>
  discarded: string[]
  copy: (
    path: string,
    bytes?: number,
    mtimeMs?: number,
    serverId?: string
  ) => ServerFileCopy<string>
} {
  const discarded: string[] = []
  const copies = new ServerFileCopies<string>(maxBytes, (c) => discarded.push(c.data))
  const copy = (
    path: string,
    bytes = 10,
    mtimeMs = 1000,
    serverId = 's1'
  ): ServerFileCopy<string> => ({
    serverId,
    path,
    version: { mtimeMs, size: bytes },
    kind: 'image',
    bytes,
    data: `${serverId}:${path}@${mtimeMs}`
  })
  return { copies, discarded, copy }
}

describe('ServerFileCopies', () => {
  it('版本对得上才复用；对不上即作废并丢弃', () => {
    const { copies, discarded, copy } = setup()
    const a = copy('/a.png')
    copies.keep(a, copies.epoch('s1'))
    expect(copies.take('s1', '/a.png', { mtimeMs: 1000, size: 10 })).toBe(a)
    expect(copies.take('s1', '/a.png', { mtimeMs: 2000, size: 10 })).toBeNull()
    expect(discarded).toEqual(['s1:/a.png@1000'])
    expect(copies.take('s1', '/a.png', { mtimeMs: 1000, size: 10 })).toBeNull()
  })

  it('按服务器区分同一路径', () => {
    const { copies, copy } = setup()
    copies.keep(copy('/a.png', 10, 1000, 's1'), copies.epoch('s1'))
    expect(copies.take('s2', '/a.png', { mtimeMs: 1000, size: 10 })).toBeNull()
  })

  it('下载期间有过自己的改动：不收下', () => {
    const { copies, copy } = setup()
    const epoch = copies.epoch('s1')
    copies.forget('s1', ['/other'])
    expect(copies.keep(copy('/a.png'), epoch)).toBe(false)
    expect(copies.take('s1', '/a.png', { mtimeMs: 1000, size: 10 })).toBeNull()
  })

  it('别的服务器上的改动不影响', () => {
    const { copies, copy } = setup()
    const epoch = copies.epoch('s1')
    copies.forget('s2', ['/a.png'])
    expect(copies.keep(copy('/a.png'), epoch)).toBe(true)
  })

  it('比上限还大的不收下', () => {
    const { copies, copy } = setup(100)
    expect(copies.keep(copy('/big.mp4', 101), copies.epoch('s1'))).toBe(false)
  })

  it('同一路径的新版本替换旧版本', () => {
    const { copies, discarded, copy } = setup()
    copies.keep(copy('/a.png', 10, 1000), copies.epoch('s1'))
    copies.keep(copy('/a.png', 10, 2000), copies.epoch('s1'))
    expect(discarded).toEqual(['s1:/a.png@1000'])
  })

  it('超出上限：淘汰最久没用的，复用过的算最近用过', () => {
    const { copies, discarded, copy } = setup(30)
    copies.keep(copy('/a'), copies.epoch('s1'))
    copies.keep(copy('/b'), copies.epoch('s1'))
    copies.keep(copy('/c'), copies.epoch('s1'))
    copies.take('s1', '/a', { mtimeMs: 1000, size: 10 })
    copies.keep(copy('/d'), copies.epoch('s1'))
    expect(discarded).toEqual(['s1:/b@1000'])
  })

  it('淘汰时跳过正在显示的那份', () => {
    const { copies, discarded, copy } = setup(20)
    const a = copy('/a')
    copies.keep(a, copies.epoch('s1'))
    copies.show('s1', a)
    copies.keep(copy('/b'), copies.epoch('s1'))
    copies.keep(copy('/c'), copies.epoch('s1'))
    expect(discarded).toEqual(['s1:/b@1000'])
  })

  it('正在显示的被作废：先留着，换下来再丢弃', () => {
    const { copies, discarded, copy } = setup()
    const a = copy('/a')
    copies.keep(a, copies.epoch('s1'))
    copies.show('s1', a)
    copies.forget('s1', ['/a'])
    expect(discarded).toEqual([])
    copies.show('s1', null)
    expect(discarded).toEqual(['s1:/a@1000'])
  })

  it('换下来的若还在账上，不丢弃', () => {
    const { copies, discarded, copy } = setup()
    const a = copy('/a')
    copies.keep(a, copies.epoch('s1'))
    copies.show('s1', a)
    copies.show('s1', null)
    expect(discarded).toEqual([])
  })

  it('没收下的：显示时留着，用完（settle）即丢弃', () => {
    const { copies, discarded, copy } = setup()
    const a = copy('/a')
    copies.show('s1', a)
    copies.settle(a)
    expect(discarded).toEqual([])
    const b = copy('/b')
    copies.settle(b)
    expect(discarded).toEqual(['s1:/b@1000'])
  })

  it('作废一个文件夹：连同其下的一切，不误伤同名前缀', () => {
    const { copies, discarded, copy } = setup()
    for (const p of ['/d', '/d/x', '/d/e/y', '/dx']) copies.keep(copy(p), copies.epoch('s1'))
    copies.forget('s1', ['/d'])
    expect(discarded.sort()).toEqual(['s1:/d/e/y@1000', 's1:/d/x@1000', 's1:/d@1000'])
  })

  it('丢掉某台服务器的全部，连同正在显示的；别的服务器不动', () => {
    const { copies, discarded, copy } = setup()
    const a = copy('/a', 10, 1000, 's1')
    copies.keep(a, copies.epoch('s1'))
    copies.show('s1', a)
    const shownOnly = copy('/b', 10, 1000, 's1')
    copies.show('s1', shownOnly)
    copies.keep(copy('/a', 10, 1000, 's2'), copies.epoch('s2'))
    copies.drop('s1')
    expect(discarded.sort()).toEqual(['s1:/a@1000', 's1:/b@1000'])
    expect(copies.take('s2', '/a', { mtimeMs: 1000, size: 10 })).not.toBeNull()
  })

  it('丢掉后，进行中的下载不再收下', () => {
    const { copies, copy } = setup()
    const epoch = copies.epoch('s1')
    copies.drop('s1')
    expect(copies.keep(copy('/a'), epoch)).toBe(false)
  })
})
