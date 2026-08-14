// Git 提交详情 / diff 面板的纯逻辑（details-diff 规格）：文件树构建与单链压缩展平、
// 提交信息正文分词（URL 自动链接）、单文件 diff 端点解析、diff 盖板收口、超大 diff 截断。
// 与 React 无关；组件文件受 react-refresh only-export-components 限制不宜导出纯函数，
// 故独立成模块供 GitCommitDetails / GitDiffView 消费并单测（写法对齐 git-format.ts）。

import {
  GIT_INDEX,
  UNCOMMITTED,
  type GitCommitStash,
  type GitFileChange,
  type GitFileStatus,
  type GitUncommittedDetails
} from '@shared/git'

// —— 文件状态展示 ——

/** 文件状态 → 中文文案（tooltip / 徽标 title，details-diff §7.4）。 */
export const FILE_STATUS_LABEL: Record<GitFileStatus, string> = {
  A: '已添加',
  M: '已修改',
  D: '已删除',
  R: '已重命名',
  U: '未跟踪',
  '!': '冲突'
}

/** 文件状态 → 颜色（Dark.icls FILESTATUS_*；未跟踪 U 故意跟新增同色，不对齐 UNKNOWN）。 */
export const FILE_STATUS_COLOR: Record<GitFileStatus, string> = {
  A: 'var(--git-status-added)',
  U: 'var(--git-status-added)',
  M: 'var(--git-status-modified)',
  R: 'var(--git-status-modified)',
  D: 'var(--git-status-deleted)',
  '!': 'var(--git-status-conflict)'
}

/**
 * 未提交两段 → 相对仓库根路径的工作区展示状态（供 Files 树上色）。
 * 优先级：冲突 > 未暂存 > 已暂存；跳过 isDir（目录名仍走默认正文色）。
 */
export function workingTreeStatusByPath(
  uncommitted: GitUncommittedDetails
): Map<string, GitFileStatus> {
  const m = new Map<string, GitFileStatus>()
  for (const f of uncommitted.staged) {
    if (f.isDir) continue
    m.set(f.newFilePath, f.type)
  }
  for (const f of uncommitted.unstaged) {
    if (f.isDir) continue
    m.set(f.newFilePath, f.type)
  }
  for (const f of uncommitted.conflicted) {
    if (f.isDir) continue
    m.set(f.newFilePath, '!')
  }
  return m
}

/**
 * 该文件行能否打开 diff：未跟踪目录整体条目（isDir）没有 diff 可看，其余一律可点——
 * 是否二进制由点开后的单文件 diff 判定（面板内展示「二进制文件不支持对比」），列表阶段不预判。
 */
export function diffPossible(file: GitFileChange): boolean {
  return file.isDir !== true
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

/** 文件的 pathspec：重命名（R）需同时覆盖旧 / 新两端（git add / reset），其余仅新路径。 */
export function pathspecOf(file: GitFileChange): string[] {
  return file.type === 'R' ? [file.oldFilePath, file.newFilePath] : [file.newFilePath]
}

/**
 * 把文件树选区解析成去重文件列表：选区 key 为文件行的 newFilePath 或目录行的 folderPath 混合，
 * 每个 key 匹配「自身即该文件」或「以 key + '/' 为前缀（目录下全部文件）」的文件。
 * 按 files 原序输出（同段内 newFilePath 唯一，目录与其内文件同选也不重复）。
 */
export function filesInSelection(
  files: readonly GitFileChange[],
  selectedKeys: ReadonlySet<string>
): GitFileChange[] {
  return files.filter((f) =>
    [...selectedKeys].some((key) => f.newFilePath === key || f.newFilePath.startsWith(`${key}/`))
  )
}

/**
 * 树的全部行 key（目录 folderPath + 文件 newFilePath），目录取单链压缩后的形态。
 * 选区幽灵清理据此校验：刷新落地后剔除不在集合内的 key——压缩链形态变化时旧目录 key
 * 即失效；若仅按前缀匹配放行，隐形的失效目录 key 会把文件偷偷带进批量操作。
 */
export function treeRowKeys(files: readonly GitFileChange[]): Set<string> {
  return new Set(
    flattenFileTree(buildFileTree(files), new Set()).map((row) =>
      row.kind === 'folder' ? row.folderPath : files[row.index].newFilePath
    )
  )
}

/**
 * 提交面板「推送」勾选可用性：有当前分支，或空仓库（无 HEAD——首次提交会让分支出生，
 * 提交成功后再弹推送对话框）；detached HEAD（无当前分支但有 HEAD）提交完仍无分支可推，禁用。
 */
export function canPushAfterCommit(currentBranch: string | null, headHash: string | null): boolean {
  return currentBranch !== null || headHash === null
}

/** 文件行能否在 Files Tab 打开工作区那份：已删除没有工作区文件，未跟踪目录不是单文件。 */
export function canOpenWorkingTreeFile(file: GitFileChange): boolean {
  return file.type !== 'D' && file.isDir !== true
}

/** 文件行 tooltip（§7.4）：可点性提示 • 状态文案，rename 附「旧 → 新」。 */
export function fileRowTitle(file: GitFileChange): string {
  const click = !diffPossible(file)
    ? '无法查看差异（这是一个未跟踪目录）'
    : canOpenWorkingTreeFile(file)
      ? '点击查看差异，双击打开文件'
      : '点击查看差异'
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
  // 防御分支，正常不可达：未提交行详情（非比较）恒走提交面板，文件点击用
  // uncommittedDiffEndpoints。'HEAD' 端点依赖 HEAD 已出生，若未来复用需先兜住空仓库
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

// —— Diff 盖板收口（临时面板：树里没了就关，活端点跟着刷） ——

/** 详情展开态里 reconcileDiffView 需要的切片。 */
export interface DiffReconcileExpanded {
  loading: boolean
  hash: string
  compareWith: string | null
  details: { fileChanges: GitFileChange[] } | null
  fileChanges: GitFileChange[] | null
  uncommitted: GitUncommittedDetails | null
}

export type DiffReconcileResult =
  | { action: 'keep' }
  | { action: 'close' }
  | { action: 'refresh'; file: GitFileChange; fromHash: string; toHash: string }

/** 活端点：已暂存 / 未暂存 / 与工作区对比。两端都是提交 hash 的是历史 diff，不刷。 */
export function isLiveDiff(fromHash: string, toHash: string): boolean {
  return fromHash === GIT_INDEX || toHash === GIT_INDEX || toHash === UNCOMMITTED
}

function findByPath(files: readonly GitFileChange[], path: string): GitFileChange | undefined {
  return files.find((f) => f.newFilePath === path)
}

/**
 * 详情/文件树刷新后，当前打开的 diff 该关、该留，还是换端点重拉。
 * 树还没落地（loading / 列表 null）不当「不存在」，避免软刷新闪关。
 */
export function reconcileDiffView(
  diff: { file: GitFileChange; fromHash: string; toHash: string },
  expanded: DiffReconcileExpanded | null
): DiffReconcileResult {
  if (expanded === null) return { action: 'close' }
  if (expanded.loading) return { action: 'keep' }

  const path = diff.file.newFilePath
  const isCommitPanel = expanded.hash === UNCOMMITTED && expanded.compareWith === null

  if (isCommitPanel) {
    const u = expanded.uncommitted
    if (u === null) return { action: 'keep' }
    const inStaged = findByPath(u.staged, path)
    const inUnstaged = findByPath(u.unstaged, path) ?? findByPath(u.conflicted, path)
    if (inStaged === undefined && inUnstaged === undefined) return { action: 'close' }

    const unstagedEp = uncommittedDiffEndpoints('unstaged')
    const stagedEp = uncommittedDiffEndpoints('staged')
    const onUnstaged = diff.fromHash === unstagedEp.fromHash && diff.toHash === unstagedEp.toHash
    const onStaged = diff.fromHash === stagedEp.fromHash && diff.toHash === stagedEp.toHash

    if (onUnstaged && inUnstaged !== undefined) {
      return { action: 'refresh', file: inUnstaged, ...unstagedEp }
    }
    if (onStaged && inStaged !== undefined) {
      return { action: 'refresh', file: inStaged, ...stagedEp }
    }
    if (inUnstaged !== undefined) return { action: 'refresh', file: inUnstaged, ...unstagedEp }
    if (inStaged !== undefined) return { action: 'refresh', file: inStaged, ...stagedEp }
    return { action: 'close' }
  }

  const files =
    expanded.compareWith !== null ? expanded.fileChanges : (expanded.details?.fileChanges ?? null)
  if (files === null) return { action: 'keep' }
  const found = findByPath(files, path)
  if (found === undefined) return { action: 'close' }
  if (isLiveDiff(diff.fromHash, diff.toHash)) {
    return { action: 'refresh', file: found, fromHash: diff.fromHash, toHash: diff.toHash }
  }
  return { action: 'keep' }
}

// —— Diff 面板导航（头部上下箭头切改动块、左右箭头切文件，对齐 WebStorm） ——

/** 左右切换序列的一项：文件 + 打开它的 diff 端点。 */
export interface DiffNavEntry {
  file: GitFileChange
  fromHash: string
  toHash: string
}

/** 文件树显示顺序（忽略折叠状态）的文件序列：与文件树的完整视觉顺序一致。 */
function filesInTreeOrder(files: readonly GitFileChange[]): GitFileChange[] {
  return flattenFileTree(buildFileTree(files), new Set()).flatMap((row) =>
    row.kind === 'file' ? [files[row.index]] : []
  )
}

/**
 * 左右箭头的文件切换序列：提交面板按显示顺序两段相连（已暂存在前、未暂存含冲突在后，
 * 端点随段），其余（详情 / 比较 / stash）取当前文件树逐个解析端点。收起的文件夹不影响
 * 序列（按完整树顺序走），未跟踪目录条目也保留（面板对它显示提示，不跳过）。
 */
export function diffNavSequence(
  expanded: (DiffEndpointContext & DiffReconcileExpanded) | null,
  rowIndexOf: (hash: string) => number
): DiffNavEntry[] {
  if (expanded === null) return []
  if (expanded.hash === UNCOMMITTED && expanded.compareWith === null) {
    const u = expanded.uncommitted
    if (u === null) return []
    const stagedEp = uncommittedDiffEndpoints('staged')
    const unstagedEp = uncommittedDiffEndpoints('unstaged')
    return [
      ...filesInTreeOrder(u.staged).map((file) => ({ file, ...stagedEp })),
      ...filesInTreeOrder([...u.unstaged, ...u.conflicted]).map((file) => ({ file, ...unstagedEp }))
    ]
  }
  const files =
    expanded.compareWith !== null ? expanded.fileChanges : (expanded.details?.fileChanges ?? null)
  if (files === null) return []
  return filesInTreeOrder(files).map((file) => ({
    file,
    ...resolveDiffEndpoints(file, expanded, rowIndexOf)
  }))
}

/** 当前打开的 diff 在序列中的下标（端点 + 新路径匹配，同路径可在两段各现一次）；找不到 -1。 */
export function diffNavIndex(
  sequence: readonly DiffNavEntry[],
  diff: { file: GitFileChange; fromHash: string; toHash: string }
): number {
  return sequence.findIndex(
    (e) =>
      e.fromHash === diff.fromHash &&
      e.toHash === diff.toHash &&
      e.file.newFilePath === diff.file.newFilePath
  )
}

/** 行「是否改动行」序列 → 各改动块首行下标（连续改动行合为一块，同 WebStorm 的 change）。 */
export function changeBlockStarts(isDiffRow: readonly boolean[]): number[] {
  const starts: number[] = []
  for (let i = 0; i < isDiffRow.length; i++) {
    if (isDiffRow[i] && (i === 0 || !isDiffRow[i - 1])) starts.push(i)
  }
  return starts
}

/** 视口锚位置对应的当前改动块下标：最后一个 top 不超过锚（+2px 容差）的块；全在锚下方为 -1。 */
export function currentBlockIndex(tops: readonly number[], anchorY: number): number {
  let idx = -1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= anchorY + 2) idx = i
  }
  return idx
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
