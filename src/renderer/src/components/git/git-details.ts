// Git 提交详情 / diff 面板的纯逻辑（details-diff 规格）：文件树构建与单链压缩展平、
// 提交信息正文分词（URL 自动链接）、单文件 diff 端点解析、超大 diff 截断。
// 与 React 无关；组件文件受 react-refresh only-export-components 限制不宜导出纯函数，
// 故独立成模块供 GitCommitDetails / GitDiffView 消费并单测（写法对齐 git-format.ts）。

import {
  GIT_INDEX,
  UNCOMMITTED,
  type DiffHunk,
  type DiffLine,
  type GitCommitStash,
  type GitFileChange,
  type GitFileStatus
} from '@shared/git'

// —— 文件状态展示 ——

/** 文件状态 → 中文文案（tooltip / 徽标 title，details-diff §7.4）。 */
export const FILE_STATUS_LABEL: Record<GitFileStatus, string> = {
  A: '已添加',
  M: '已修改',
  D: '已删除',
  R: '已重命名',
  U: '未跟踪'
}

/** 文件状态 → 颜色（A/U 绿、M/R 蓝、D 红），全部取既有 token 不写裸 hex。 */
export const FILE_STATUS_COLOR: Record<GitFileStatus, string> = {
  A: 'var(--status-success)',
  U: 'var(--status-success)',
  M: 'var(--git-graph-color0)',
  R: 'var(--git-graph-color0)',
  D: 'var(--status-failed)'
}

/** 该文件行能否打开 diff：未跟踪恒可（主进程合成新增 hunk），其余需有行数（二进制为 null）。 */
export function diffPossible(file: GitFileChange): boolean {
  return file.type === 'U' || file.additions !== null
}

// —— 文件树（details-diff §7.1–7.3） ——

export interface FileTreeFile {
  type: 'file'
  /** 路径最后一段文件名 */
  name: string
  /** fileChanges 下标，交互经它反查文件对象 */
  index: number
}

export interface FileTreeFolder {
  type: 'folder'
  name: string
  /** 相对仓库根的完整目录路径（如 'src/utils'；根为 ''） */
  folderPath: string
  contents: Record<string, FileTreeNode>
}

export type FileTreeNode = FileTreeFolder | FileTreeFile

/** 按 newFilePath 分段建树。开合状态不入树：由组件按 folderPath 记「收起集合」，换树自然失效。 */
export function buildFileTree(fileChanges: readonly GitFileChange[]): FileTreeFolder {
  const root: FileTreeFolder = { type: 'folder', name: '', folderPath: '', contents: {} }
  for (let i = 0; i < fileChanges.length; i++) {
    const segs = fileChanges[i].newFilePath.split('/')
    let cur = root
    for (let j = 0; j < segs.length; j++) {
      if (j < segs.length - 1) {
        // 中间段 → 文件夹（同名文件与文件夹冲突在 git 路径中不可能出现，防御性覆盖）
        let next = cur.contents[segs[j]]
        if (next === undefined || next.type !== 'folder') {
          next = {
            type: 'folder',
            name: segs[j],
            folderPath: segs.slice(0, j + 1).join('/'),
            contents: {}
          }
          cur.contents[segs[j]] = next
        }
        cur = next
      } else if (segs[j] !== '') {
        cur.contents[segs[j]] = { type: 'file', name: segs[j], index: i }
      }
    }
  }
  return root
}

/** 文件树的一个渲染行（已完成单链压缩、排序与收起过滤的展平结果）。 */
export type FileTreeRow =
  | { kind: 'folder'; name: string; folderPath: string; depth: number; open: boolean }
  | { kind: 'file'; name: string; index: number; depth: number }

/** 排序（§7.3）：文件夹在前、文件在后，同类按名称 localeCompare。 */
function sortedChildren(folder: FileTreeFolder): FileTreeNode[] {
  return Object.values(folder.contents).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** 唯一子节点且为文件夹时返回它（单链压缩的下钻条件），否则 null。 */
function soleChildFolder(folder: FileTreeFolder): FileTreeFolder | null {
  const values = Object.values(folder.contents)
  const only = values.length === 1 ? values[0] : undefined
  return only !== undefined && only.type === 'folder' ? only : null
}

/**
 * 展平为渲染行：单链文件夹压缩（§7.2，显示名 'a / b / c'、开合对象取链上最深文件夹）、
 * 收起的文件夹（closed 命中 folderPath）不输出其子行。根自身不产生行。
 */
export function flattenFileTree(root: FileTreeFolder, closed: ReadonlySet<string>): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const walk = (folder: FileTreeFolder, depth: number): void => {
    for (const node of sortedChildren(folder)) {
      if (node.type === 'file') {
        rows.push({ kind: 'file', name: node.name, index: node.index, depth })
        continue
      }
      let deepest = node
      let name = node.name
      let sole = soleChildFolder(deepest)
      while (sole !== null) {
        deepest = sole
        name += ` / ${sole.name}`
        sole = soleChildFolder(deepest)
      }
      const open = !closed.has(deepest.folderPath)
      rows.push({ kind: 'folder', name, folderPath: deepest.folderPath, depth, open })
      if (open) walk(deepest, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

/** 文件行 tooltip（§7.4）：可点性提示 • 状态文案，rename 附「旧 → 新」。 */
export function fileRowTitle(file: GitFileChange): string {
  const click = diffPossible(file) ? '点击查看差异' : '无法查看差异（这是一个二进制文件）'
  const status =
    file.type === 'R'
      ? `${FILE_STATUS_LABEL.R} (${file.oldFilePath} → ${file.newFilePath})`
      : FILE_STATUS_LABEL[file.type]
  return `${click} • ${status}`
}

// —— 单文件 diff 端点解析（details-diff §7.5） ——

/** 决定 diff 端点所需的展开态最小切片（GitExpandedState 的子集，纯数据便于单测）。 */
export interface DiffEndpointContext {
  hash: string
  stash: GitCommitStash | null
  compareWith: string | null
}

/** 比较端点归一化：行序靠下（下标大）= 较老 = from；未提交行下标 0 恒为 to（§6.1）。 */
export function normalizeCompare(
  hashA: string,
  hashB: string,
  rowIndexOf: (hash: string) => number
): { fromHash: string; toHash: string } {
  return rowIndexOf(hashA) >= rowIndexOf(hashB)
    ? { fromHash: hashA, toHash: hashB }
    : { fromHash: hashB, toHash: hashA }
}

/**
 * 单击文件行 → openDiff 的 from/to（§7.5，对齐 GitDiffRequest 注释语义）：
 * 比较模式取归一化两端；stash 的未跟踪文件两端都是第三父提交（该提交自身的新增）；
 * stash 其余文件 baseHash → stash 提交；未提交行 HEAD → 工作区（'*'）；
 * 普通提交 from === to === hash（「提交自身变更」，旧侧取 hash^ 由主进程处理，勿在此加 '^'）。
 */
export function resolveDiffEndpoints(
  file: GitFileChange,
  exp: DiffEndpointContext,
  rowIndexOf: (hash: string) => number
): { fromHash: string; toHash: string } {
  if (exp.compareWith !== null) return normalizeCompare(exp.hash, exp.compareWith, rowIndexOf)
  if (exp.stash !== null) {
    if (file.type === 'U' && exp.stash.untrackedFilesHash !== null) {
      return { fromHash: exp.stash.untrackedFilesHash, toHash: exp.stash.untrackedFilesHash }
    }
    return { fromHash: exp.stash.baseHash, toHash: exp.hash }
  }
  if (exp.hash === UNCOMMITTED) return { fromHash: 'HEAD', toHash: UNCOMMITTED }
  return { fromHash: exp.hash, toHash: exp.hash }
}

/**
 * 提交面板（未提交行详情）文件行 → openDiff 的端点：已暂存段看 HEAD→暂存区快照、
 * 未暂存段看 暂存区→工作区。未跟踪行同用 unstaged 端点——diff 请求按 type='U'
 * 优先走 no-index 合成新增 hunk，无需特判。
 */
export function uncommittedDiffEndpoints(section: 'staged' | 'unstaged'): {
  fromHash: string
  toHash: string
} {
  return section === 'staged'
    ? { fromHash: 'HEAD', toHash: GIT_INDEX }
    : { fromHash: GIT_INDEX, toHash: UNCOMMITTED }
}

// —— 提交信息正文分词（§5.1：URL 自动链接；哈希链接 v1 不做） ——

export type BodyToken = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string }

/** URL 起始匹配；结尾标点与不成对右括号由 trimUrlTail 修剪（§5.1 的成对括号截断）。 */
const URL_REGEX = /https?:\/\/\S+/g

/** 修剪 URL 尾部：常见结尾标点一律截掉；右括号仅在数量多于左括号（不成对）时截掉。 */
function trimUrlTail(raw: string): string {
  let url = raw
  for (;;) {
    const last = url[url.length - 1]
    if (last !== undefined && ',.?!\'":;'.includes(last)) {
      url = url.slice(0, -1)
      continue
    }
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      url = url.slice(0, -1)
      continue
    }
    return url
  }
}

/** 提交信息正文 → 顺序 token 流：按 URL 切分，URL 之外的片段为纯文本。 */
export function tokenizeBody(body: string): BodyToken[] {
  const tokens: BodyToken[] = []
  const pushText = (text: string): void => {
    if (text !== '') tokens.push({ kind: 'text', text })
  }
  let last = 0
  let m: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(body)) !== null) {
    const url = trimUrlTail(m[0])
    pushText(body.slice(last, m.index))
    tokens.push({ kind: 'link', text: url, url })
    last = m.index + url.length
    URL_REGEX.lastIndex = last // 修剪掉的尾标点归还给后续文本
  }
  pushText(body.slice(last))
  return tokens
}

// —— diff 面板辅助（§10.4 渲染端截断 + hunk 头还原） ——

/** 超大 diff 的渲染截断阈值（行）：超过先渲染前 N 行并给「仍要全部渲染」入口。 */
export const DIFF_RENDER_LIMIT = 20000

/** 全部 hunk 的 diff 行总数。 */
export function countDiffLines(hunks: readonly DiffHunk[]): number {
  return hunks.reduce((n, h) => n + h.lines.length, 0)
}

/** 按行数上限截取 hunks；跨越边界的 hunk 截其 lines（不改原对象）。 */
export function limitDiffHunks(hunks: readonly DiffHunk[], maxLines: number): DiffHunk[] {
  const out: DiffHunk[] = []
  let remaining = maxLines
  for (const h of hunks) {
    if (remaining <= 0) break
    if (h.lines.length <= remaining) {
      out.push(h)
      remaining -= h.lines.length
    } else {
      out.push({ ...h, lines: h.lines.slice(0, remaining) })
      remaining = 0
    }
  }
  return out
}

/** 结构化 hunk → 展示原样的头行文本「@@ -a,b +c,d @@ 上下文」。 */
export function formatHunkHeader(h: DiffHunk): string {
  const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`
  return h.sectionHeader === '' ? head : `${head} ${h.sectionHeader}`
}

/** 左右对比 diff 的一行：left = 旧侧（context / del / null 占位），right = 新侧（context / add / null）。 */
export interface SplitDiffRow {
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * 把一个 hunk 的行序列配对成左右对比行（unified → side-by-side）：
 * context 两侧同显；一段连续的 del 与紧随其后的 add 按序两两配对（del 在左、add 在右），
 * 多出的一侧与 null 配对（另一侧留空占位）。纯函数，供 GitDiffView 与单测。
 */
export function splitDiffRows(lines: readonly DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'context') {
      rows.push({ left: lines[i], right: lines[i] })
      i++
      continue
    }
    // 收集一段连续的 del，再收集紧随的 add，按行序两两配对
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++])
    const n = Math.max(dels.length, adds.length)
    for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null })
  }
  return rows
}
