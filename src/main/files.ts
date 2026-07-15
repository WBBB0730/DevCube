import { promises as fs } from 'node:fs'
import path from 'node:path'
import { classifyFilesOpenKind, resolveFilesOpenKind, type FilesOpenKind } from '../shared/files-kind'
import { normalizePath, resolveWithinProject } from '../shared/files-path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import {
  FILES_RECENT_MAX,
  type FilesDirEntry,
  type FilesReadResult,
  type FilesUiState
} from '../shared/files'
import { getProjects } from './store'

const MAX_TEXT_BYTES = 5 * 1024 * 1024

/** 逻辑路径（/）→ 系统路径。 */
function toSys(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}

function assertProjectRoot(projectPath: string): string {
  const root = normalizePath(projectPath)
  if (!getProjects().some((p) => normalizePath(p.path) === root)) {
    throw new Error('项目未登记')
  }
  return root
}

function within(projectPath: string, candidate: string): string {
  const root = assertProjectRoot(projectPath)
  const resolved = resolveWithinProject(root, candidate)
  if (!resolved) throw new Error('路径越界')
  return resolved
}

export async function listDir(projectPath: string, dirPath: string): Promise<FilesDirEntry[]> {
  const logical = within(projectPath, dirPath || '.')
  const sys = toSys(logical)
  const names = await fs.readdir(sys)
  const entries: FilesDirEntry[] = []
  for (const name of names) {
    if (isIdeIgnoredEntryName(name)) continue
    const childLogical = normalizePath(logical + '/' + name)
    const st = await fs.lstat(toSys(childLogical)).catch(() => null)
    if (!st) continue
    entries.push({
      name,
      path: childLogical,
      isDirectory: st.isDirectory()
    })
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return entries
}

export async function readFileEntry(
  projectPath: string,
  filePath: string
): Promise<FilesReadResult> {
  const logical = within(projectPath, filePath)
  const sys = toSys(logical)
  const st = await fs.stat(sys)
  if (st.isDirectory()) throw new Error('不能打开目录')
  const name = path.basename(sys)
  const byName = classifyFilesOpenKind(name)

  if (byName === 'image') {
    const buf = await fs.readFile(sys)
    const ext = path.extname(name).slice(1).toLowerCase() || 'png'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return {
      kind: 'image',
      path: logical,
      dataUrl: `data:image/${mime};base64,${buf.toString('base64')}`
    }
  }

  const buf = await fs.readFile(sys)
  const kind: FilesOpenKind = resolveFilesOpenKind(name, buf)
  if (kind === 'image') {
    // 不应走到：byName 已处理图片扩展
    const ext = path.extname(name).slice(1).toLowerCase() || 'png'
    return {
      kind: 'image',
      path: logical,
      dataUrl: `data:image/${ext};base64,${buf.toString('base64')}`
    }
  }
  if (kind === 'other' || buf.length > MAX_TEXT_BYTES) {
    return { kind: 'other', path: logical, size: buf.length }
  }
  return {
    kind: 'text',
    path: logical,
    content: buf.toString('utf8'),
    mtimeMs: st.mtimeMs
  }
}

export async function writeFileEntry(
  projectPath: string,
  filePath: string,
  content: string
): Promise<{ mtimeMs: number }> {
  const logical = within(projectPath, filePath)
  const sys = toSys(logical)
  await fs.writeFile(sys, content, 'utf8')
  const st = await fs.stat(sys)
  return { mtimeMs: st.mtimeMs }
}

export async function fileExists(projectPath: string, filePath: string): Promise<boolean> {
  try {
    const logical = within(projectPath, filePath)
    await fs.access(toSys(logical))
    return true
  } catch {
    return false
  }
}

/** 读取 UI 态时清掉已不存在的 openPath / 最近打开；最近列表空且仍有 openPath 时用其种子。 */
export async function sanitizeFilesUi(
  projectPath: string,
  ui: FilesUiState
): Promise<FilesUiState> {
  let openPath = ui.openPath
  if (openPath) {
    const ok = await fileExists(projectPath, openPath).catch(() => false)
    if (!ok) openPath = null
  }

  const recentPaths: string[] = []
  for (const p of ui.recentPaths) {
    if (recentPaths.length >= FILES_RECENT_MAX) break
    if (recentPaths.includes(p)) continue
    const ok = await fileExists(projectPath, p).catch(() => false)
    if (ok) recentPaths.push(p)
  }
  if (recentPaths.length === 0 && openPath) recentPaths.push(openPath)

  const recentSame =
    recentPaths.length === ui.recentPaths.length &&
    recentPaths.every((p, i) => p === ui.recentPaths[i])
  if (openPath === ui.openPath && recentSame) return ui
  return { ...ui, openPath, recentPaths }
}
