import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { detectAv } from '@file-type/av'
import { fileTypeFromFile } from 'file-type'
import {
  classifyFilesOpenKind,
  filesOpenKindFromMime,
  primaryMime,
  sniffTextBuffer,
  type FilesOpenKind
} from '../shared/files-kind'
import { normalizePath, resolveWithinProject } from '../shared/files-path'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import { filterFilesListTree, type FilesTreeFilterResult } from '../shared/files-tree-search'
import {
  FILES_RECENT_MAX,
  buildFilesMediaUrl,
  compareFilesDirEntries,
  type FilesDirEntry,
  type FilesReadResult,
  type FilesUiState
} from '../shared/files'
import { getFilesIndex } from './files-index'
import { execGit, resolveRepoRoot } from './git-exec'
import { getProjects } from './store'

const MAX_TEXT_BYTES = 5 * 1024 * 1024

/** 逻辑路径（/）→ 系统路径。 */
function toSys(logical: string): string {
  return path.normalize(logical.split('/').join(path.sep))
}

export function assertProjectRoot(projectPath: string): string {
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
  entries.sort(compareFilesDirEntries)
  return entries
}

function toRepoRel(repoRootLogical: string, logical: string): string {
  const repo = normalizePath(repoRootLogical)
  const p = normalizePath(logical)
  if (p === repo) return '.'
  if (p.startsWith(repo + '/')) return p.slice(repo.length + 1)
  return p
}

/**
 * 树顶过滤：从文件名索引（rg --files 枚举 + 内存匹配，ADR-0027）构建过滤树。
 * 空查询返回空展开、仅根列举（调用方应短路不调）。
 */
export async function filterFilesTreeQuery(
  projectPath: string,
  query: string
): Promise<FilesTreeFilterResult> {
  const root = assertProjectRoot(projectPath)
  const q = query.trim()
  if (!q) {
    return { childrenByDir: { [root]: await listDir(projectPath, root) }, expandedPaths: [] }
  }
  return filterFilesListTree(root, await getFilesIndex(root), q)
}

function imageDataUrl(buf: Buffer, mimeOrExt: string): string {
  if (mimeOrExt.includes('/')) {
    return `data:${mimeOrExt};base64,${buf.toString('base64')}`
  }
  const ext = mimeOrExt === 'jpg' ? 'jpeg' : mimeOrExt
  return `data:image/${ext};base64,${buf.toString('base64')}`
}

/**
 * 用 file-type + @file-type/av 读魔数；失败则 null。
 * 已知文本扩展名的调用方应短路，避免无谓扫盘。
 */
async function detectMime(sysPath: string): Promise<string | null> {
  try {
    const ft = await fileTypeFromFile(sysPath, { customDetectors: [detectAv] })
    return ft ? primaryMime(ft.mime) : null
  } catch {
    return null
  }
}

export async function readFileEntry(
  projectPath: string,
  filePath: string
): Promise<FilesReadResult> {
  const root = assertProjectRoot(projectPath)
  const logical = within(projectPath, filePath)
  const sys = toSys(logical)
  const st = await fs.stat(sys)
  if (st.isDirectory()) throw new Error('不能打开目录')
  const name = path.basename(sys)
  const byName = classifyFilesOpenKind(name)

  if (byName === 'text') {
    const buf = await fs.readFile(sys)
    if (buf.length > MAX_TEXT_BYTES) {
      return { kind: 'other', path: logical, size: buf.length }
    }
    return {
      kind: 'text',
      path: logical,
      content: buf.toString('utf8'),
      mtimeMs: st.mtimeMs
    }
  }

  const mime = await detectMime(sys)
  let kind: FilesOpenKind = byName
  if (mime) {
    const fromMime = filesOpenKindFromMime(mime)
    if (fromMime !== null) kind = fromMime
  }

  if (kind === 'audio' || kind === 'video') {
    const mediaMime = mime ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4')
    return {
      kind,
      path: logical,
      mime: mediaMime,
      mediaUrl: buildFilesMediaUrl(root, logical, mediaMime)
    }
  }

  if (kind === 'image') {
    const buf = await fs.readFile(sys)
    const ext = path.extname(name).slice(1).toLowerCase() || 'png'
    return {
      kind: 'image',
      path: logical,
      dataUrl: imageDataUrl(buf, mime ?? ext)
    }
  }

  // other：已确认二进制 MIME 则不再整文件读入，只报 size；否则嗅探是否文本
  if (mime) {
    return { kind: 'other', path: logical, size: st.size }
  }

  const buf = await fs.readFile(sys)
  if (sniffTextBuffer(buf) && buf.length <= MAX_TEXT_BYTES) {
    return {
      kind: 'text',
      path: logical,
      content: buf.toString('utf8'),
      mtimeMs: st.mtimeMs
    }
  }
  return { kind: 'other', path: logical, size: buf.length }
}

/**
 * 读取文件在 HEAD 的基线文本（编辑器 gutter diff 条纹的对比端）。
 * 非仓库 / HEAD 无此路径（未跟踪、未出生、重命名未提交）/ 二进制 / 超限 → null（不显示条纹）。
 */
export async function readHeadText(projectPath: string, filePath: string): Promise<string | null> {
  const logical = within(projectPath, filePath)
  const repoRootSys = await resolveRepoRoot(toSys(normalizePath(projectPath)))
  if (!repoRootSys) return null
  const rel = toRepoRel(normalizePath(repoRootSys), logical)
  if (rel === '.') return null
  const result = await execGit(repoRootSys, ['show', `HEAD:${rel}`])
  if (result.code !== 0) return null
  const buf = result.stdout
  if (buf.length > MAX_TEXT_BYTES || !sniffTextBuffer(buf)) return null
  return buf.toString('utf8')
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

/** 新建 / 重命名的名称校验：单段、非空、不含分隔符；其余交由文件系统报错。 */
function assertEntryName(name: string): void {
  if (name === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error('名称无效')
  }
}

export async function createEntry(
  projectPath: string,
  dirPath: string,
  name: string,
  kind: 'file' | 'directory'
): Promise<FilesDirEntry> {
  const parent = within(projectPath, dirPath)
  assertEntryName(name)
  const logical = normalizePath(parent + '/' + name)
  const sys = toSys(logical)
  try {
    // wx / mkdir：已存在即失败，创建与查重原子完成
    if (kind === 'directory') await fs.mkdir(sys)
    else await fs.writeFile(sys, '', { flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('已存在同名条目')
    throw e
  }
  return { name, path: logical, isDirectory: kind === 'directory' }
}

/** 就地重命名（不跨目录）；大小写不敏感文件系统上允许仅改大小写。 */
export async function renameEntry(
  projectPath: string,
  entryPath: string,
  newName: string
): Promise<{ path: string }> {
  const logical = within(projectPath, entryPath)
  if (logical === normalizePath(projectPath)) throw new Error('不能重命名项目根目录')
  assertEntryName(newName)
  const parent = logical.slice(0, logical.lastIndexOf('/'))
  const target = normalizePath(parent + '/' + newName)
  if (target === logical) return { path: logical }
  const caseOnly = target.toLowerCase() === logical.toLowerCase()
  const exists = await fs.access(toSys(target)).then(
    () => true,
    () => false
  )
  if (exists && !caseOnly) throw new Error('已存在同名条目')
  await fs.rename(toSys(logical), toSys(target))
  return { path: target }
}

/** 移入系统回收站（可恢复；不做永久删除）。 */
export async function trashEntry(projectPath: string, entryPath: string): Promise<void> {
  const logical = within(projectPath, entryPath)
  if (logical === normalizePath(projectPath)) throw new Error('不能删除项目根目录')
  await shell.trashItem(toSys(logical))
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
