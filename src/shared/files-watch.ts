import type { FilesDirEntry, FilesReadResult } from './files'

/** 两份目录列举是否观察等价（顺序敏感：listDir 已排序）。 */
export function sameDirEntries(a: FilesDirEntry[], b: FilesDirEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.name !== y.name || x.path !== y.path || x.isDirectory !== y.isDirectory) return false
  }
  return true
}

/**
 * 把新列举合并进缓存：目录仍在则替换（无变化保留原数组引用）；
 * 列举失败（目录已删等）则从缓存移除该键及其后代键。
 */
export function mergeReloadedDirs(
  prev: Record<string, FilesDirEntry[]>,
  reloaded: Record<string, FilesDirEntry[] | null>
): Record<string, FilesDirEntry[]> {
  let changed = false
  const next: Record<string, FilesDirEntry[]> = { ...prev }
  for (const [dir, entries] of Object.entries(reloaded)) {
    if (entries === null) {
      if (!(dir in next)) continue
      changed = true
      delete next[dir]
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      for (const key of Object.keys(next)) {
        if (key.startsWith(prefix)) delete next[key]
      }
      continue
    }
    const old = next[dir]
    if (old && sameDirEntries(old, entries)) continue
    next[dir] = entries
    changed = true
  }
  return changed ? next : prev
}

export type OpenTextDiskSync =
  | { action: 'noop' }
  | { action: 'reload'; content: string; mtimeMs: number }
  | { action: 'conflict'; disk: string; mtimeMs: number }
  | { action: 'gone' }
  | { action: 'reopen' }

/**
 * 当前打开文本相对一次磁盘读结果该怎么同步。
 * fresh=null 表示路径已不存在 / 读失败。
 */
export function resolveOpenTextDiskSync(
  loaded: { path: string; mtimeMs: number; dirty: boolean },
  fresh: FilesReadResult | null
): OpenTextDiskSync {
  if (!fresh || fresh.path !== loaded.path) return { action: 'gone' }
  if (fresh.kind !== 'text') return { action: 'reopen' }
  if (fresh.mtimeMs === loaded.mtimeMs) return { action: 'noop' }
  if (loaded.dirty) return { action: 'conflict', disk: fresh.content, mtimeMs: fresh.mtimeMs }
  return { action: 'reload', content: fresh.content, mtimeMs: fresh.mtimeMs }
}
