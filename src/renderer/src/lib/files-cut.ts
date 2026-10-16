/**
 * 文件树里被剪切、等着粘贴即移动的那一批（docs/prd/files-tree-move-copy.md「剪贴板」）：主进程统一记，
 * 这里订阅推送，被剪切的行淡显。别处复制了东西没人通知，窗口回到前台时向主进程核对一次（只在有剪切时）。
 */
import { useSyncExternalStore } from 'react'

let cut: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
let started = false

function update(paths: string[]): void {
  cut = new Set(paths)
  for (const listener of listeners) listener()
}

function start(): void {
  if (started) return
  started = true
  window.api.onFilesCutChanged(update)
  const check = (): void => void window.api.filesCutPaths().then(update, () => undefined)
  check()
  window.addEventListener('focus', () => {
    if (cut.size > 0) check()
  })
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 被剪切、等着粘贴的路径 */
export function useFilesCut(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => cut)
}
