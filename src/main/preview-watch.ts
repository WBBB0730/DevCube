import { randomUUID } from 'node:crypto'
import { promises as fs } from 'original-fs'
import { wslDistroOf } from '../shared/wsl-path'
import { subscribeDir, type DirSubscription, type DirWatchEvent } from './dir-watch'
import { classifyWatchPathAll, pathHasIdeIgnoredSegment } from './project-watch-classify'
import { invalidateFilesIndex } from './files-index'
import { LinkedDirWatches, hostLinkedDirs } from './linked-dir-watch'
import { connectWsl, holdWsl, releaseWsl } from './wsl'

const FILES_DEBOUNCE_MS = 750

/**
 * Preview Window 当前根的递归文件监听（与项目监听同栈，见 dir-watch，只驱动 files 通道）：
 * 尾沿防抖后作废该根的文件名索引并回调；根切换 / 关窗时 dispose。根在 WSL 发行版里时，开着期间算「在用」，
 * 连上后再订阅（docs/prd/wsl-project.md）。经符号链接列到根以外的目录另起监听（linked-dir-watch，ADR-0059），
 * WSL 里的根不做。
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

  const changed = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (closed) return
      invalidateFilesIndex(rootSys)
      onChange()
    }, FILES_DEBOUNCE_MS)
  }

  const linked =
    distro === null
      ? new LinkedDirWatches(
          fs.realpath(rootSys).catch(() => rootSys),
          (err: Error | null, events: DirWatchEvent[]) => {
            if (closed) return
            if (err !== null || events.some((event) => !pathHasIdeIgnoredSegment(event.path))) {
              changed()
            }
          }
        )
      : null
  const unhostLinked = linked !== null ? hostLinkedDirs(rootSys, linked) : null

  void ready
    .then(() =>
      subscribeDir(rootSys, (err, events) => {
        if (err || closed) return
        const hit = events.some((event) =>
          classifyWatchPathAll(rootSys, null, event.path).some((c) => c.kind === 'files')
        )
        if (hit) changed()
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
      unhostLinked?.()
      const sub = subscription
      subscription = null
      await Promise.all([sub?.unsubscribe(), linked?.dispose()])
    }
  }
}
