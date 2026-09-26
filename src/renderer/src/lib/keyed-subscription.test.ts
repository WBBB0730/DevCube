import { describe, expect, it } from 'vitest'
import { createKeyedSubscription } from './keyed-subscription'

type Ev = { key: string; data: string }

/** 模拟 preload 暴露的推送频道：记录底层监听数。 */
function fakeChannel(): {
  subscribe: (cb: (e: Ev) => void) => () => void
  emit: (e: Ev) => void
  count: () => number
} {
  const listeners = new Set<(e: Ev) => void>()
  return {
    subscribe: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    emit: (e) => listeners.forEach((l) => l(e)),
    count: () => listeners.size
  }
}

describe('createKeyedSubscription', () => {
  it('多个 key 共用一个底层监听', () => {
    const ch = fakeChannel()
    const on = createKeyedSubscription(ch.subscribe, (e) => e.key)
    for (let i = 0; i < 20; i++) on(`k${i}`, () => {})
    expect(ch.count()).toBe(1)
  })

  it('事件只送到所属 key 的订阅方', () => {
    const ch = fakeChannel()
    const on = createKeyedSubscription(ch.subscribe, (e) => e.key)
    const a: string[] = []
    const b: string[] = []
    on('a', (e) => a.push(e.data))
    on('b', (e) => b.push(e.data))
    ch.emit({ key: 'a', data: '1' })
    ch.emit({ key: 'b', data: '2' })
    ch.emit({ key: 'c', data: '3' })
    expect(a).toEqual(['1'])
    expect(b).toEqual(['2'])
  })

  it('最后一个订阅方退订即摘掉底层监听，再订阅重新挂上', () => {
    const ch = fakeChannel()
    const on = createKeyedSubscription(ch.subscribe, (e) => e.key)
    const offA = on('a', () => {})
    const offB = on('b', () => {})
    offA()
    expect(ch.count()).toBe(1)
    offB()
    expect(ch.count()).toBe(0)
    const got: string[] = []
    on('a', (e) => got.push(e.data))
    expect(ch.count()).toBe(1)
    ch.emit({ key: 'a', data: 'x' })
    expect(got).toEqual(['x'])
  })

  it('同一 key 多个订阅方各自收到、各自退订（如 StrictMode 双挂载）', () => {
    const ch = fakeChannel()
    const on = createKeyedSubscription(ch.subscribe, (e) => e.key)
    const first: string[] = []
    const second: string[] = []
    const offFirst = on('a', (e) => first.push(e.data))
    on('a', (e) => second.push(e.data))
    ch.emit({ key: 'a', data: '1' })
    offFirst()
    ch.emit({ key: 'a', data: '2' })
    expect(first).toEqual(['1'])
    expect(second).toEqual(['1', '2'])
  })

  it('重复退订不误删同 key 的新订阅', () => {
    const ch = fakeChannel()
    const on = createKeyedSubscription(ch.subscribe, (e) => e.key)
    const offOld = on('a', () => {})
    offOld()
    const got: string[] = []
    on('a', (e) => got.push(e.data))
    offOld()
    ch.emit({ key: 'a', data: 'x' })
    expect(got).toEqual(['x'])
    expect(ch.count()).toBe(1)
  })
})
