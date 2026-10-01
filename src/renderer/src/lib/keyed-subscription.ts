import { useEffect, useState } from 'react'

/**
 * 同一推送频道只挂一个底层监听，按事件所属的 key 分发给各订阅方。
 * 常驻面板各挂一个监听时，监听数随面板数增长：每条推送都要挨个判断归属，超过 10 个还会触发
 * Node 的 MaxListenersExceededWarning——那条线是留给泄漏的提醒，面板数又没有上限，调高它不对症。
 * 底层监听在首个订阅方到来时挂上、最后一个退订时摘掉。
 */
export function createKeyedSubscription<E>(
  subscribe: (cb: (event: E) => void) => () => void,
  keyOf: (event: E) => string
): (key: string, cb: (event: E) => void) => () => void {
  const handlers = new Map<string, Set<(event: E) => void>>()
  let unsubscribe: (() => void) | null = null

  return (key, cb) => {
    let set = handlers.get(key)
    if (!set) {
      set = new Set()
      handlers.set(key, set)
    }
    set.add(cb)
    unsubscribe ??= subscribe((event) => {
      handlers.get(keyOf(event))?.forEach((handler) => handler(event))
    })

    return () => {
      set.delete(cb)
      // 同 key 退空后可能已换成新集合（退订后又有人订阅），只清理自己那一份。
      if (set.size === 0 && handlers.get(key) === set) handlers.delete(key)
      if (handlers.size === 0) {
        unsubscribe?.()
        unsubscribe = null
      }
    }
  }
}

/**
 * 按 key 推送的状态（连接状态、控制台上下文、运行结果等，主进程持有）：订阅 key 的推送，同时查一次当前值（渲染端重载、
 * 面板重新挂上后接上主进程里已有的），取最新到的；pick 从推送的事件里取值。值连同它所属的 key 一起存：key 变了而值
 * 还是旧的，即尚未得知，为 undefined。subscribe、fetch 与 pick 要保持同一个引用（模块级）。
 */
export function useKeyedPushed<E, V>(
  key: string,
  subscribe: (key: string, cb: (event: E) => void) => () => void,
  fetch: (key: string) => Promise<V>,
  pick: (event: E) => V
): V | undefined {
  const [known, setKnown] = useState<{ key: string; value: V } | null>(null)
  useEffect(() => {
    let current = true
    const unsubscribe = subscribe(key, (event) => setKnown({ key, value: pick(event) }))
    void fetch(key).then((value) => {
      if (current) setKnown({ key, value })
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [key, subscribe, fetch, pick])
  return known?.key === key ? known.value : undefined
}
