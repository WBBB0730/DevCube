import parcelWatcher, { type AsyncSubscription } from '@parcel/watcher'
import { classifyWatchPathAll } from './project-watch-classify'
import { invalidateFilesIndex } from './files-index'

const FILES_DEBOUNCE_MS = 750

/**
 * Preview Window 当前根的递归文件监听（与项目监听同栈 @parcel/watcher，只驱动 files 通道）：
 * 尾沿防抖后作废该根的文件名索引并回调；根切换 / 关窗时 dispose。
 */
export function watchPreviewRoot(
  rootSys: string,
  onChange: () => void
): { dispose: () => Promise<void> } {
  let closed = false
  let subscription: AsyncSubscription | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  void parcelWatcher
    .subscribe(rootSys, (err, events) => {
      if (err || closed) return
      const hit = events.some((event) =>
        classifyWatchPathAll(rootSys, null, event.path).some((c) => c.kind === 'files')
      )
      if (!hit) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (closed) return
        invalidateFilesIndex(rootSys)
        onChange()
      }, FILES_DEBOUNCE_MS)
    })
    .then(async (sub) => {
      if (closed) await sub.unsubscribe()
      else subscription = sub
    })
    .catch(() => undefined)

  return {
    dispose: async () => {
      closed = true
      if (timer) clearTimeout(timer)
      timer = null
      const sub = subscription
      subscription = null
      if (sub) await sub.unsubscribe()
    }
  }
}
