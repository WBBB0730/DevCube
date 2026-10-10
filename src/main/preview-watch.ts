import { randomUUID } from 'node:crypto'
import { wslDistroOf } from '../shared/wsl-path'
import { subscribeDir, type DirSubscription } from './dir-watch'
import { classifyWatchPathAll } from './project-watch-classify'
import { invalidateFilesIndex } from './files-index'
import { connectWsl, holdWsl, releaseWsl } from './wsl'

const FILES_DEBOUNCE_MS = 750

/**
 * Preview Window 当前根的递归文件监听（与项目监听同栈，见 dir-watch，只驱动 files 通道）：
 * 尾沿防抖后作废该根的文件名索引并回调；根切换 / 关窗时 dispose。根在 WSL 发行版里时，开着期间算「在用」，
 * 连上后再订阅（docs/prd/wsl-project.md）。
 */
export function watchPreviewRoot(
  rootSys: string,
  onChange: () => void
): { dispose: () => Promise<void> } {
  let closed = false
  let subscription: DirSubscription | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const distro = wslDistroOf(rootSys)
  const holder = `preview:${randomUUID()}`
  if (distro !== null) holdWsl(distro, holder)
  const ready = distro !== null ? connectWsl(distro) : Promise.resolve()

  void ready
    .then(() =>
      subscribeDir(rootSys, (err, events) => {
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
    )
    .then(async (sub) => {
      if (closed) await sub.unsubscribe()
      else subscription = sub
    })
    .catch(() => undefined)

  return {
    dispose: async () => {
      closed = true
      if (distro !== null) releaseWsl(distro, holder)
      if (timer) clearTimeout(timer)
      timer = null
      const sub = subscription
      subscription = null
      if (sub) await sub.unsubscribe()
    }
  }
}
