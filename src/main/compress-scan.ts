import type { Stats } from 'node:fs'
// 用户的文件用不带 asar 改装的原版 fs：Electron 改装过的 fs 会把 .asar 文件当成文件夹往里读（ADR-0051）
import { promises as originalFs } from 'original-fs'
import { basename, join, relative, sep } from 'node:path'
import {
  MAC_JUNK_HEADER_BYTES,
  archiveEntryName,
  isMacJunkDirName,
  isMacJunkHeader,
  macJunkFileKind,
  type CompressContentFlags,
  type MacJunkFileKind,
  type CompressOptions,
  type CompressPreview
} from '../shared/compress'
import { normalizePath } from '../shared/files-path'
import { execGit, findGit, getErrorMessage } from './git-exec'

/**
 * 压缩清单（docs/prd/compress.md「清单」）：列出所选条目里要装进包的目录、文件与符号链接。
 * 自己遍历、不跟随符号链接；「被 Git 忽略」交给 git 自己判定——仓库里的内容用
 * `git ls-files --cached --others --exclude-standard` 列出（已跟踪的加上未跟踪且没被忽略的，即 Git 眼中的项目），
 * 嵌套 .gitignore、全局排除、info/exclude、「已跟踪的文件不算忽略」都与 Git 一致。
 * 不用 ripgrep 文件索引（ADR-0027）：实测它不列符号链接与空文件夹，也不区分已跟踪的文件。
 * `.git` 与 Mac 专属文件只做标记，勾选变化时在内存里过滤，不必重新扫盘。
 */

export interface CompressEntry {
  kind: 'dir' | 'file' | 'link'
  /** 系统路径 */
  path: string
  /** 包内路径（相对共同上层文件夹，`/` 分隔） */
  name: string
  /** Unix 权限位与类型（写进包的外部属性） */
  mode: number
  mtimeMs: number
  /** 文件字节数；目录与符号链接为 0 */
  size: number
  /** 符号链接的目标（原样，不解析） */
  target?: string
  /** 在 `.git` 里（含 `.git` 本身） */
  inGit: boolean
  /** Mac 专属文件，或在 `__MACOSX` 里 */
  macJunk: boolean
}

export interface CompressListing {
  entries: CompressEntry[]
  flags: CompressContentFlags
}

export interface CompressGitResult {
  code: number
  stdout: Buffer
  message: string
}

export interface CompressScanDeps {
  /** 本机有没有 git：没有就不做忽略判定，也不出现那个勾选框 */
  gitAvailable: () => Promise<boolean>
  /** input 写进标准输入（`check-ignore --stdin`） */
  git: (cwd: string, args: string[], input?: Buffer) => Promise<CompressGitResult>
}

const defaultDeps: CompressScanDeps = {
  gitAvailable: async () => (await findGit()) !== null,
  git: async (cwd, args, input) => {
    const result = await execGit(cwd, args, input)
    return { code: result.code, stdout: result.stdout, message: getErrorMessage(result) }
  }
}

/** 同时在途的 lstat 上限：大仓库一次列出十几万个路径，分批发出。 */
const STAT_BATCH = 512
/** 一次交给 git 的所选条目上限：全选一个大文件夹时条目很多，分批传，免得超出命令行长度 */
const PATHSPEC_BATCH = 200

type Marks = { inGit: boolean; macJunk: boolean }

class AbortedError extends Error {
  constructor() {
    super('已取消')
  }
}

export function isScanAborted(err: unknown): boolean {
  return err instanceof AbortedError
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await originalFs.lstat(path)
  } catch {
    return null
  }
}

async function statAll(paths: string[]): Promise<(Stats | null)[]> {
  const out: (Stats | null)[] = []
  for (let i = 0; i < paths.length; i += STAT_BATCH) {
    out.push(...(await Promise.all(paths.slice(i, i + STAT_BATCH).map(lstatOrNull))))
  }
  return out
}

/** 读文件开头几个字节（判断是不是 Mac 专属文件）；读不了为 null。 */
async function readHeader(path: string): Promise<Uint8Array | null> {
  let handle: Awaited<ReturnType<typeof originalFs.open>> | null = null
  try {
    handle = await originalFs.open(path, 'r')
    const buf = Buffer.alloc(MAC_JUNK_HEADER_BYTES)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

function splitNul(stdout: Buffer): string[] {
  return [
    ...new Set(
      stdout
        .toString('utf8')
        .split('\0')
        .filter((s) => s !== '')
    )
  ]
}

/**
 * 扫描所选条目。excludeIgnored 为 true 时，仓库里的内容按 Git 的规则列出；否则一律遍历磁盘。
 * 只选一个时它本身总会装进去（明确选了它），排除规则只作用于它里面的内容；多选（如在 Finder 里全选一个文件夹的
 * 内容）等同于压它们所在文件夹的内容，所选条目本身也按规则处理。
 */
export async function scanCompressItems(
  items: readonly string[],
  parent: string,
  excludeIgnored: boolean,
  signal?: AbortSignal,
  deps: CompressScanDeps = defaultDeps
): Promise<CompressListing> {
  const parentLogical = normalizePath(parent)
  const flags: CompressContentFlags = { hasRepo: false, hasDotGit: false, hasMacJunk: false }
  const entries: CompressEntry[] = []
  const gitAvailable = await deps.gitAvailable()
  const useGit = excludeIgnored && gitAvailable

  const checkAborted = (): void => {
    if (signal?.aborted) throw new AbortedError()
  }

  /** 名字像 Mac 专属文件的条目，扫完后再读文件头确认 */
  const junkCandidates: { entry: CompressEntry; kind: MacJunkFileKind }[] = []

  /** checkJunk：只选一个时它本身不参与 Mac 专属文件的判定（明确选了它，总会装进去） */
  const add = async (path: string, st: Stats, marks: Marks, checkJunk = true): Promise<void> => {
    const kind = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file'
    const entry: CompressEntry = {
      kind,
      path,
      name: archiveEntryName(parentLogical, path),
      mode: st.mode & 0xffff,
      mtimeMs: st.mtimeMs,
      size: kind === 'file' ? st.size : 0,
      ...(kind === 'link' ? { target: await originalFs.readlink(path) } : {}),
      ...marks
    }
    entries.push(entry)
    const junkKind = macJunkFileKind(basename(path))
    if (checkJunk && kind === 'file' && !marks.macJunk && junkKind !== null) {
      junkCandidates.push({ entry, kind: junkKind })
    }
  }

  /** 名字像的再读文件头，对得上才标记为 Mac 专属文件（自己起名叫 `._xxx` 的普通文件照常装） */
  const confirmMacJunk = async (): Promise<void> => {
    for (let i = 0; i < junkCandidates.length; i += STAT_BATCH) {
      checkAborted()
      const batch = junkCandidates.slice(i, i + STAT_BATCH)
      const headers = await Promise.all(batch.map((c) => readHeader(c.entry.path)))
      batch.forEach((c, j) => {
        const header = headers[j]
        if (header !== null && isMacJunkHeader(c.kind, header)) {
          c.entry.macJunk = true
          flags.hasMacJunk = true
        }
      })
    }
  }

  // `__MACOSX` 文件夹按名字认，整支标记；`.DS_Store` 与 `._*` 要看文件头（confirmMacJunk）
  const childMarks = (marks: Marks, name: string): Marks => ({
    inGit: marks.inGit || name === '.git',
    macJunk: marks.macJunk || isMacJunkDirName(name)
  })

  const noteMarks = (parentMarks: Marks, name: string, marks: Marks): void => {
    if (name === '.git' && !parentMarks.inGit) flags.hasDotGit = true
    if (marks.macJunk && !parentMarks.macJunk) flags.hasMacJunk = true
  }

  /** 遍历磁盘；遇到仓库根（有 `.git`）且要排除忽略的文件时，改由 git 列出它的内容。 */
  const walk = async (dir: string, marks: Marks): Promise<void> => {
    checkAborted()
    const names = (await originalFs.readdir(dir)).sort()
    if (!marks.inGit && names.includes('.git') && gitAvailable) {
      flags.hasRepo = true
      if (useGit) {
        await listByGit(dir, marks)
        return
      }
    }
    const paths = names.map((name) => join(dir, name))
    const stats = await statAll(paths)
    for (let i = 0; i < names.length; i++) {
      const st = stats[i]
      if (st === null) continue
      const m = childMarks(marks, names[i])
      noteMarks(marks, names[i], m)
      await add(paths[i], st, m)
      if (st.isDirectory()) await walk(paths[i], m)
    }
  }

  /** 跑一条 git 命令，取 NUL 分隔的输出；ok 为认作成功的退出码（check-ignore 一个都没命中时退出码为 1）。 */
  const git = async (
    cwd: string,
    args: string[],
    input?: Buffer,
    ok: readonly number[] = [0]
  ): Promise<string[]> => {
    const result = await deps.git(cwd, args, input)
    if (!ok.includes(result.code)) throw new Error(`读取 Git 忽略规则失败：${result.message}`)
    return splitNul(result.stdout)
  }

  /**
   * 仓库里的内容：git 列出文件（含嵌套仓库的入口），目录由文件路径补齐，空文件夹另行补上。
   * selection：只列 dir 下这些条目（相对 dir、`/` 分隔；多选时用），条目本身被忽略的同样不列——
   * 交给 git 的是条目路径，所以被忽略的目录里强制提交的文件照样列出。
   */
  const listByGit = async (dir: string, marks: Marks, selection?: string[]): Promise<void> => {
    checkAborted()
    const dotGit = join(dir, '.git')
    const dotGitStat =
      selection === undefined || selection.includes('.git') ? await lstatOrNull(dotGit) : null
    if (dotGitStat !== null) {
      const m = childMarks(marks, '.git')
      noteMarks(marks, '.git', m)
      await add(dotGit, dotGitStat, m)
      if (dotGitStat.isDirectory()) await walk(dotGit, m)
    }

    const listArgs = ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
    let files: string[]
    if (selection === undefined) {
      files = await git(dir, listArgs)
    } else {
      // 按字面匹配条目路径（文件名里的 * ? 不当通配符）
      const listed = new Set<string>()
      for (let i = 0; i < selection.length; i += PATHSPEC_BATCH) {
        const chunk = selection.slice(i, i + PATHSPEC_BATCH)
        for (const f of await git(dir, ['--literal-pathspecs', ...listArgs, '--', ...chunk])) {
          listed.add(f)
        }
      }
      files = [...listed]
    }
    const added = new Set<string>()
    /** 补上包内路径的各级上层目录（相对 dir、`/` 分隔），并返回这一路的标记 */
    const ensureDirs = async (rel: string): Promise<Marks> => {
      const segments = rel.split('/')
      let m = marks
      for (let i = 0; i < segments.length - 1; i++) {
        m = childMarks(m, segments[i])
        const relDir = segments.slice(0, i + 1).join('/')
        if (added.has(relDir)) continue
        added.add(relDir)
        const path = join(dir, ...segments.slice(0, i + 1))
        const st = await lstatOrNull(path)
        if (st !== null) await add(path, st, m)
      }
      return m
    }

    const rels = files.map((f) => f.replace(/\/$/, ''))
    for (let i = 0; i < rels.length; i += STAT_BATCH) {
      checkAborted()
      const batch = rels.slice(i, i + STAT_BATCH)
      const stats = await statAll(batch.map((rel) => join(dir, ...rel.split('/'))))
      for (let j = 0; j < batch.length; j++) {
        const st = stats[j]
        // 已跟踪但磁盘上已删掉的文件
        if (st === null) continue
        const rel = batch[j]
        const path = join(dir, ...rel.split('/'))
        const parentMarksOf = await ensureDirs(rel)
        const name = rel.slice(rel.lastIndexOf('/') + 1)
        const m = childMarks(parentMarksOf, name)
        noteMarks(parentMarksOf, name, m)
        if (st.isDirectory()) {
          // 嵌套仓库（子模块或未跟踪的仓库）：git 只给出入口，内容按它自己的规则列
          if (added.has(rel)) continue
          added.add(rel)
          await add(path, st, m)
          flags.hasRepo = true
          if ((await lstatOrNull(join(path, '.git'))) !== null) await listByGit(path, m)
          continue
        }
        await add(path, st, m)
      }
    }

    // 空文件夹：git 不列目录。从已列出内容的目录（含 dir 本身）往下找没列到的子目录，交给
    // `git check-ignore` 判定（-z 只能配合 --stdin，ADR-0009）：没被忽略的是空文件夹（或只剩空文件夹、
    // 被忽略的文件），补上并继续往下找；被忽略的整支跳过，不进去遍历。按层批量判定。
    let level = selection === undefined ? ['', ...added] : [...added]
    // 多选时，所选的文件夹本身没列到内容（空的，或里面全被忽略）的，同样交给 check-ignore 判定
    let selectedDirs: string[] = []
    if (selection !== undefined) {
      for (const rel of selection) {
        if (rel === '.git' || added.has(rel)) continue
        const st = await lstatOrNull(join(dir, ...rel.split('/')))
        if (st?.isDirectory()) selectedDirs.push(rel)
      }
    }
    while (level.length > 0 || selectedDirs.length > 0) {
      checkAborted()
      const candidates: string[] = selectedDirs
      selectedDirs = []
      for (const relDir of level) {
        const abs = relDir === '' ? dir : join(dir, ...relDir.split('/'))
        const children = await originalFs.readdir(abs, { withFileTypes: true }).catch(() => [])
        for (const child of children) {
          if (!child.isDirectory() || child.name === '.git') continue
          const rel = relDir === '' ? child.name : `${relDir}/${child.name}`
          if (!added.has(rel)) candidates.push(rel)
        }
      }
      if (candidates.length === 0) break
      const ignored = new Set(
        await git(
          dir,
          ['check-ignore', '--stdin', '-z'],
          Buffer.from(candidates.join('\0') + '\0', 'utf8'),
          [0, 1]
        )
      )
      level = []
      for (const rel of candidates.sort()) {
        if (ignored.has(rel)) continue
        const path = join(dir, ...rel.split('/'))
        const st = await lstatOrNull(path)
        if (st === null) continue
        added.add(rel)
        const parentMarksOf = await ensureDirs(rel)
        const name = rel.slice(rel.lastIndexOf('/') + 1)
        const m = childMarks(parentMarksOf, name)
        noteMarks(parentMarksOf, name, m)
        await add(path, st, m)
        level.push(rel)
      }
    }
  }

  const insideWorkTree = async (dir: string): Promise<boolean> => {
    if (!gitAvailable) return false
    const result = await deps.git(dir, ['rev-parse', '--is-inside-work-tree'])
    return result.code === 0 && result.stdout.toString('utf8').trim() === 'true'
  }

  /** 所选的一个文件夹：在仓库里且要排除忽略的文件时由 git 列，否则遍历磁盘。 */
  const scanDir = async (dir: string, marks: Marks): Promise<void> => {
    if (!marks.inGit && (await insideWorkTree(dir))) {
      flags.hasRepo = true
      if (useGit) {
        await listByGit(dir, marks)
        return
      }
    }
    await walk(dir, marks)
  }

  const top: Marks = { inGit: false, macJunk: false }
  const collect = async (): Promise<void> => {
    if (items.length === 1) {
      const st = await originalFs.lstat(items[0])
      await add(items[0], st, top, false)
      if (st.isDirectory()) await scanDir(items[0], top)
      return
    }
    // 多选：所选条目本身也按规则处理。所在文件夹在仓库里且要排除忽略的文件时，整批交给 git 一次列出
    if (await insideWorkTree(parent)) {
      flags.hasRepo = true
      if (useGit) {
        const selection = items.map((item) => relative(parent, item).split(sep).join('/'))
        await listByGit(parent, top, selection)
        return
      }
    }
    for (const item of items) {
      checkAborted()
      const st = await originalFs.lstat(item)
      const name = basename(item)
      const marks = childMarks(top, name)
      noteMarks(top, name, marks)
      await add(item, st, marks)
      if (st.isDirectory()) await scanDir(item, marks)
    }
  }

  await collect()
  await confirmMacJunk()
  return { entries, flags }
}

/** 按勾选过滤：`.git` 与 Mac 专属文件只做了标记（只选一个时，它本身从不标记）。 */
export function filterCompressEntries(
  entries: readonly CompressEntry[],
  options: Pick<CompressOptions, 'excludeGit' | 'excludeMacJunk'>
): CompressEntry[] {
  return entries.filter(
    (e) => !(options.excludeGit && e.inGit) && !(options.excludeMacJunk && e.macJunk)
  )
}

/** 预览：文件与符号链接的个数、文件总字节数。 */
export function previewOf(entries: readonly CompressEntry[]): CompressPreview {
  let files = 0
  let bytes = 0
  for (const e of entries) {
    if (e.kind === 'dir') continue
    files++
    bytes += e.size
  }
  return { files, bytes }
}
