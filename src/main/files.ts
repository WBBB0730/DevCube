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
import { filterFilesTree, type FilesTreeFilterResult } from '../shared/files-tree-search'
import {
  FILES_RECENT_MAX,
  type FilesDirEntry,
  type FilesReadResult,
  type FilesUiState
} from '../shared/files'
import { buildFilesMediaUrl } from './files-media-protocol'
import { execGit, resolveRepoRoot } from './git-exec'
import { getProjects } from './store'

const CHECK_IGNORE_BATCH = 100

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

function toRepoRel(repoRootLogical: string, logical: string): string {
  const repo = normalizePath(repoRootLogical)
  const p = normalizePath(logical)
  if (p === repo) return '.'
  if (p.startsWith(repo + '/')) return p.slice(repo.length + 1)
  return p
}

/** 批量 `git check-ignore`；非仓库或调用失败 → 空集（不过滤）。 */
async function collectIgnoredLogical(
  repoRootLogical: string | null,
  logicalPaths: string[]
): Promise<Set<string>> {
  const ignored = new Set<string>()
  if (!repoRootLogical || logicalPaths.length === 0) return ignored

  const pairs = logicalPaths.map((logical) => ({
    logical: normalizePath(logical),
    rel: toRepoRel(repoRootLogical, logical)
  }))

  for (let i = 0; i < pairs.length; i += CHECK_IGNORE_BATCH) {
    const batch = pairs.slice(i, i + CHECK_IGNORE_BATCH)
    // 不用 -z：Apple Git / 多数版本里 -z 仅配合 --stdin；命令行路径加 -z 会 fatal(128)，
    // 导致整批跳过、扫进 node_modules 等被 ignore 的巨树。
    const result = await execGit(toSys(repoRootLogical), [
      'check-ignore',
      '--',
      ...batch.map((p) => p.rel)
    ])
    // 0 = 至少一个被 ignore；1 = 全未 ignore；其它 = 失败（当作本批无 ignore）
    if (result.code !== 0) continue
    const ignoredRels = new Set(
      result.stdout
        .toString('utf8')
        .split(/\r?\n/)
        .filter((p) => p !== '')
    )
    for (const p of batch) {
      if (ignoredRels.has(p.rel)) ignored.add(p.logical)
    }
  }
  return ignored
}

/**
 * 树顶过滤：扫盘构建可搜索树（IDE 忽略 + gitignore），再按查询收窄。
 * 空查询返回空展开、仅根列举（调用方应短路不调）。
 */
export async function filterFilesTreeScan(
  projectPath: string,
  query: string
): Promise<FilesTreeFilterResult> {
  const root = assertProjectRoot(projectPath)
  const q = query.trim()
  if (!q) {
    return { childrenByDir: { [root]: await listDir(projectPath, root) }, expandedPaths: [] }
  }

  const repoRootSys = await resolveRepoRoot(toSys(root))
  const repoRootLogical = repoRootSys ? normalizePath(repoRootSys) : null

  const full: Record<string, FilesDirEntry[]> = {}

  const walk = async (dirLogical: string): Promise<void> => {
    let entries: FilesDirEntry[]
    try {
      entries = await listDir(projectPath, dirLogical)
    } catch {
      full[dirLogical] = []
      return
    }
    const ignored = await collectIgnoredLogical(
      repoRootLogical,
      entries.map((e) => e.path)
    )
    const kept = entries.filter((e) => !ignored.has(normalizePath(e.path)))
    full[dirLogical] = kept
    for (const e of kept) {
      if (e.isDirectory) await walk(e.path)
    }
  }

  await walk(root)
  return filterFilesTree(root, full, q)
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
