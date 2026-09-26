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
