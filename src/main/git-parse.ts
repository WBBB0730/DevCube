// git stdout 的纯解析器 —— 零 IO、零 electron：「给我 stdout，我给你结构」。
// 移植自 vscode-git-graph dataSource.ts 的解析面（data-read.md §3-§9）；命令编排在 git-data.ts。
// 全部函数以真实样本字符串直接测试（见 git-parse.test.ts）；损坏输入返回空值而非抛错。

import { UNCOMMITTED } from '../shared/git'
import type {
  DiffFileData,
  DiffHunk,
  GitCommit,
  GitCommitDetails,
  GitFileChange,
  GitFileStatus,
  GitTagDetails
} from '../shared/git'

// —— 常量 ——

/** 各字段之间的分隔符，随机长串保证几乎不可能撞上提交内容。 */
export const GIT_LOG_SEPARATOR = 'XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb'

/** 行分割：兼容 \r\n / \r / \n。 */
export const EOL_REGEX = /\r\n|\r|\n/g

/** 无效分支名（git branch 输出中的伪条目，如 "(HEAD detached at 1a2b3c4)"、"(no branch)"）。 */
export const INVALID_BRANCH_REGEXP = /^\(.* .*\)$/

/** remote HEAD 伪分支（git branch -a 输出形如 "remotes/origin/HEAD -> origin/main"）。 */
export const REMOTE_HEAD_BRANCH_REGEXP = /^remotes\/.*\/HEAD$/

// 以下 format 常量与各解析器的字段序一一对应，git-data 组命令时必须引用它们，避免两处漂移。
// v1 固定：日期用作者日期（%at）、不启用 mailmap（%an/%ae）、不做 GPG 校验（详情 8/9/10 位空占位）。

/** git log 的 --format（6 字段，对应 parseLog）。 */
export const GIT_FORMAT_LOG = ['%H', '%P', '%an', '%ae', '%at', '%s'].join(GIT_LOG_SEPARATOR)

/** git reflog refs/stash 的 --format（7 字段，对应 parseStashes）。 */
export const GIT_FORMAT_STASH = ['%H', '%P', '%gD', '%an', '%ae', '%at', '%s'].join(
  GIT_LOG_SEPARATOR
)

/** git show --quiet 的 --format（恒 12 字段，对应 parseDetails；GPG 关闭时 8/9/10 位空占位）。 */
export const GIT_FORMAT_DETAILS = [
  '%H',
  '%P',
  '%an',
  '%ae',
  '%at',
  '%cn',
  '%ce',
  '%ct',
  '',
  '',
  '',
  '%B'
].join(GIT_LOG_SEPARATOR)

/** git for-each-ref refs/tags/<name> 的 --format（6 字段，对应 parseTagDetails）。 */
export const GIT_FORMAT_TAG_DETAILS = [
  '%(objectname)',
  '%(taggername)',
  '%(taggeremail)',
  '%(taggerdate:unix)',
  '%(contents:signature)',
  '%(contents)'
].join(GIT_LOG_SEPARATOR)

// —— 小工具 ——

/** 路径统一为 '/' 分隔（仓库内路径一律相对仓库根、不带 ./ 前缀）。 */
function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 按 EOL 分行并去掉最后一行（git 输出以换行结尾，最后是空串；与参考实现的 length-1 循环一致）。 */
function linesExceptLast(stdout: string): string[] {
  const lines = stdout.split(EOL_REGEX)
  lines.pop()
  return lines
}

/** 去掉数组尾部的连续空行（原地修改并返回，供 %B / tag contents 收尾）。 */
function stripTrailingBlankLines(lines: string[]): string[] {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// —— §3 仓库概要：分支 / stash ——

/** git branch [-a] --no-color 的解析结果。 */
export interface GitBranchesData {
  /** 分支名列表，当前分支排在第 0 位（远程分支带 remotes/ 前缀，仅供分支筛选下拉） */
  branches: string[]
  /** 当前分支名；detached HEAD 时为 null */
  head: string | null
}

/** 解析 `git branch [-a] --no-color`：当前分支排最前，过滤伪条目 / 隐藏 remote / remote HEAD。 */
export function parseBranches(
  stdout: string,
  hideRemotes: string[],
  showRemoteHeads: boolean
): GitBranchesData {
  const branches: string[] = []
  let head: string | null = null
  for (const branchLine of linesExceptLast(stdout)) {
    // 去掉前两列标记位；"origin/HEAD -> origin/main" 只取箭头前
    const name = branchLine.substring(2).split(' -> ')[0]
    if (INVALID_BRANCH_REGEXP.test(name)) continue // detached HEAD 伪条目
    if (hideRemotes.some((remote) => name.startsWith(`remotes/${remote}/`))) continue
    if (!showRemoteHeads && REMOTE_HEAD_BRANCH_REGEXP.test(name)) continue
    if (branchLine[0] === '*') {
      head = name
      branches.unshift(name)
    } else {
      branches.push(name)
    }
  }
  return { branches, head }
}

/** 一条 stash（git reflog refs/stash 的一行）。 */
export interface GitStash {
  /** stash 提交本身的 hash（%H） */
  hash: string
  /** parents[0]，做 stash 时所在的提交 */
  baseHash: string
  /** 带 -u 创建的 stash 有第三个父提交（专存未跟踪文件）；否则 null */
  untrackedFilesHash: string | null
  /** %gD，形如 "refs/stash@{0}"；UI 展示时去掉前缀 "refs/" */
  selector: string
  author: string
  email: string
  /** Unix 秒 */
  date: number
  /** %s，形如 "WIP on main: ..." */
  message: string
}

/**
 * 解析 `git reflog --format=<GIT_FORMAT_STASH> refs/stash --`。
 * 只管格式：段数不是 7 或 parents 为空的行跳过；「仓库从没有 stash」的报错由调用方吞成 []。
 */
export function parseStashes(stdout: string): GitStash[] {
  const stashes: GitStash[] = []
  for (const stashLine of linesExceptLast(stdout)) {
    const parts = stashLine.split(GIT_LOG_SEPARATOR)
    if (parts.length !== 7 || parts[1] === '') continue
    const parents = parts[1].split(' ')
    stashes.push({
      hash: parts[0],
      baseHash: parents[0],
      // parents[1] 是暂存区快照（index 提交），读取面用不到
      untrackedFilesHash: parents.length === 3 ? parents[2] : null,
      selector: parts[2],
      author: parts[3],
      email: parts[4],
      date: parseInt(parts[5], 10),
      message: parts[6]
    })
  }
  return stashes
}

// —— §4 refs ——

/** git show-ref 的解析结果。 */
export interface GitRefData {
  /** "HEAD" 行的 hash（当前检出的提交，detached 也有值） */
  head: string | null
  heads: { hash: string; name: string }[]
  /**
   * annotated tag 产生两条：tag 对象行（annotated=false）与 ^{} 解引用行（annotated=true），
   * 都保留 —— 挂到提交上时只有 hash 命中已加载提交的那条生效；名字去重在 assembleCommits 里做
   */
  tags: { hash: string; name: string; annotated: boolean }[]
  /** name 形如 "origin/main"（已去掉 refs/remotes/ 前缀） */
  remotes: { hash: string; name: string }[]
}

/** 解析 `git show-ref [--heads --tags] -d --head`（每行 "<hash> <ref>"）。 */
export function parseRefs(
  stdout: string,
  hideRemotes: string[],
  showRemoteHeads: boolean
): GitRefData {
  const refData: GitRefData = { head: null, heads: [], tags: [], remotes: [] }
  for (const refLine of linesExceptLast(stdout)) {
    const parts = refLine.split(' ')
    if (parts.length < 2) continue
    const hash = parts[0]
    const ref = parts.slice(1).join(' ') // 防御性重连：ref 名理论上可含空格
    if (ref.startsWith('refs/heads/')) {
      refData.heads.push({ hash, name: ref.substring(11) })
    } else if (ref.startsWith('refs/tags/')) {
      const annotated = ref.endsWith('^{}')
      const name = annotated ? ref.substring(10, ref.length - 3) : ref.substring(10)
      refData.tags.push({ hash, name, annotated })
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.substring(13)
      if (hideRemotes.some((remote) => name.startsWith(`${remote}/`))) continue
      if (!showRemoteHeads && ref.endsWith('/HEAD')) continue
      refData.remotes.push({ hash, name })
    } else if (ref === 'HEAD') {
      refData.head = hash
    }
  }
  return refData
}

// —— §6 提交列表 ——

/** git log 一行的原始记录（尚未挂 refs / stash）。 */
export interface GitCommitRecord {
  hash: string
  /** 根提交为 [] */
  parents: string[]
  author: string
  email: string
  /** Unix 秒 */
  date: number
  /** %s 已把多行主题折成一行 */
  message: string
}

/** 解析 git log 的一行；段数不是 6 返回 null（尾部残缺行）。 */
export function parseLogLine(logLine: string): GitCommitRecord | null {
  const parts = logLine.split(GIT_LOG_SEPARATOR)
  if (parts.length !== 6) return null
  return {
    hash: parts[0],
    parents: parts[1] !== '' ? parts[1].split(' ') : [],
    author: parts[2],
    email: parts[3],
    date: parseInt(parts[4], 10),
    message: parts[5]
  }
}

/** 解析 `git log --format=<GIT_FORMAT_LOG>`；遇到段数不符的行直接停止（容忍尾部残缺）。 */
export function parseLog(stdout: string): GitCommitRecord[] {
  const records: GitCommitRecord[] = []
  for (const logLine of linesExceptLast(stdout)) {
    const record = parseLogLine(logLine)
    if (record === null) break
    records.push(record)
  }
  return records
}

// —— §5 未提交更改 ——

/** 解析 `git status --porcelain`（非 -z）：输出以换行结尾，行数减一即变更条数。 */
export function countPorcelainStatus(stdout: string): number {
  const lines = stdout.split(EOL_REGEX)
  return lines.length > 1 ? lines.length - 1 : 0
}

/** git status -z 中的已删除 / 未跟踪文件明细（供未提交详情合成 D / U 项）。 */
export interface GitStatusFiles {
  deleted: string[]
  untracked: string[]
}

/** 解析 `git status -s --porcelain -z`：R/C 记录的原路径是紧随其后的独立 NUL 段，要跳过。 */
export function parseStatusFilesZ(stdout: string): GitStatusFiles {
  const deleted: string[] = []
  const untracked: string[] = []
  const segments = stdout.split('\0')
  let i = 0
  while (i < segments.length) {
    const segment = segments[i]
    if (segment === '') break
    if (segment.length < 4) break // 防御：porcelain 记录至少 "XY <path>"
    const c1 = segment[0] // 暂存区状态
    const c2 = segment[1] // 工作区状态
    const filePath = normalizeGitPath(segment.substring(3))
    if (c1 === 'D' || c2 === 'D') deleted.push(filePath)
    else if (c1 === '?' || c2 === '?') untracked.push(filePath)
    i += c1 === 'R' || c2 === 'R' || c1 === 'C' || c2 === 'C' ? 2 : 1
  }
  return { deleted, untracked }
}

// —— §7.3-§7.5 文件变更（name-status / numstat / 合成） ——

/** git diff --name-status -z 的一条记录（diff-filter=AMDR 已排除其它状态）。 */
export interface DiffNameStatusRecord {
  type: 'A' | 'M' | 'D' | 'R'
  oldFilePath: string
  newFilePath: string
}

/**
 * 解析 `git diff --name-status -z`（或 diff-tree）：NUL 段序列为「状态段, 路径段[, 路径段]」。
 * diffTree=true 时先丢掉第一段（diff-tree 会先回显提交 hash）。
 */
export function parseNameStatusZ(stdout: string, diffTree: boolean): DiffNameStatusRecord[] {
  const segments = stdout.split('\0')
  if (diffTree) segments.shift()
  const records: DiffNameStatusRecord[] = []
  let i = 0
  while (i < segments.length && segments[i] !== '') {
    const type = segments[i][0] // rename 段形如 "R100"，只取首字符
    if (type === 'A' || type === 'M' || type === 'D') {
      if (i + 1 >= segments.length) break
      const filePath = normalizeGitPath(segments[i + 1])
      records.push({ type, oldFilePath: filePath, newFilePath: filePath })
      i += 2
    } else if (type === 'R') {
      if (i + 2 >= segments.length) break
      records.push({
        type,
        oldFilePath: normalizeGitPath(segments[i + 1]),
        newFilePath: normalizeGitPath(segments[i + 2])
      })
      i += 3
    } else {
      break // 其它状态（C/T/U/X…）依赖 diff-filter 已排除
    }
  }
  return records
}

/** git diff --numstat -z 的一条记录；additions/deletions 为 null 表示二进制文件。 */
export interface DiffNumStatRecord {
  filePath: string
  additions: number | null
  deletions: number | null
}

/** numstat 计数：'-'（二进制）→ null，不能让 NaN 过 IPC（序列化会变 null 掩盖问题）。 */
function parseStatCount(value: string): number | null {
  return value === '-' ? null : parseInt(value, 10)
}

/**
 * 解析 `git diff --numstat -z`（或 diff-tree）：每段 "<adds>\t<dels>\t<path>"；
 * rename 时 path 为空、后跟旧/新路径两个独立 NUL 段（取新路径）。
 */
export function parseNumStatZ(stdout: string, diffTree: boolean): DiffNumStatRecord[] {
  const segments = stdout.split('\0')
  if (diffTree) segments.shift()
  const records: DiffNumStatRecord[] = []
  let i = 0
  while (i < segments.length && segments[i] !== '') {
    const fields = segments[i].split('\t')
    if (fields.length !== 3) break
    const additions = parseStatCount(fields[0])
    const deletions = parseStatCount(fields[1])
    if (fields[2] !== '') {
      records.push({ filePath: normalizeGitPath(fields[2]), additions, deletions })
      i += 1
    } else {
      if (i + 2 >= segments.length) break
      records.push({ filePath: normalizeGitPath(segments[i + 2]), additions, deletions })
      i += 3
    }
  }
  return records
}

/**
 * 合成 GitFileChange 列表（data-read.md §7.5）：name-status 定骨架，status（仅未提交场景非
 * null）补充 D/U 项，numstat 按新路径回填增删行数（合成的 D/U 项与二进制保持 null）。
 */
export function generateFileChanges(
  nameStatus: DiffNameStatusRecord[],
  numStat: DiffNumStatRecord[],
  status: GitStatusFiles | null
): GitFileChange[] {
  const fileChanges: GitFileChange[] = nameStatus.map((record) => ({
    oldFilePath: record.oldFilePath,
    newFilePath: record.newFilePath,
    type: record.type,
    additions: null,
    deletions: null
  }))
  const fileLookup: Record<string, number> = {}
  for (let i = 0; i < fileChanges.length; i++) fileLookup[fileChanges[i].newFilePath] = i
  if (status !== null) {
    for (const filePath of status.deleted) {
      if (typeof fileLookup[filePath] === 'number') {
        // 工作区已删除但 diff 呈现为 M 的场景：改标为 D
        fileChanges[fileLookup[filePath]].type = 'D'
      } else {
        fileChanges.push({
          oldFilePath: filePath,
          newFilePath: filePath,
          type: 'D',
          additions: null,
          deletions: null
        })
      }
    }
    for (const filePath of status.untracked) {
      // untracked 永不出现在 diff 输出里，一律追加。带尾斜杠 = git 折叠的未跟踪目录 /
      // 嵌套仓库整体条目：去尾斜杠归一成一个可勾选叶子，并标 isDir（不可 diff），
      // 否则尾斜杠会让 buildFileTree 只建空目录、无文件叶子（未暂存区只见目录、无法勾选）。
      const isDir = filePath.endsWith('/')
      const path = isDir ? filePath.slice(0, -1) : filePath
      fileChanges.push({
        oldFilePath: path,
        newFilePath: path,
        type: 'U',
        additions: null,
        deletions: null,
        ...(isDir ? { isDir: true } : {})
      })
    }
  }
  for (const record of numStat) {
    const index = fileLookup[record.filePath]
    if (typeof index === 'number') {
      fileChanges[index].additions = record.additions
      fileChanges[index].deletions = record.deletions
    }
  }
  return fileChanges
}

// —— §6.3 组装 GitCommit（哨兵 / 未提交行 / stash 合并 / ref 标注） ——

/**
 * 把 log 记录组装成完整 GitCommit 列表（data-read.md §6.3）：
 * 哨兵 pop → 合成「未提交的更改」行 → 合并 stash（命中 / 插入两情况）→ 标注 heads/tags/remotes。
 * uncommittedChanges 由调用方先行计数（HEAD 不在加载窗口内时应传 0）。
 */
export function assembleCommits(
  records: GitCommitRecord[],
  refData: GitRefData,
  stashes: GitStash[],
  remotes: string[],
  opts: { maxCommits: number; showTags: boolean; uncommittedChanges: number }
): { commits: GitCommit[]; moreCommitsAvailable: boolean; tags: string[] } {
  // 1. 哨兵：请求了 maxCommits + 1 条，拿满说明还有更多，弹掉最后一条哨兵
  const moreCommitsAvailable = records.length === opts.maxCommits + 1
  const list = moreCommitsAvailable ? records.slice(0, -1) : records
  const commits: GitCommit[] = list.map((record) => ({
    ...record,
    heads: [],
    tags: [],
    remotes: [],
    stash: null
  }))
  // 2. 合成「未提交的更改」虚拟行：有变更且 HEAD 在本次加载的提交里才有意义
  const headHash = refData.head
  if (
    opts.uncommittedChanges > 0 &&
    headHash !== null &&
    commits.some((commit) => commit.hash === headHash)
  ) {
    commits.unshift({
      hash: UNCOMMITTED,
      parents: [headHash],
      author: '*',
      email: '',
      date: Math.round(Date.now() / 1000),
      message: `未提交的更改 (${opts.uncommittedChanges})`,
      heads: [],
      tags: [],
      remotes: [],
      stash: null
    })
  }
  // 3. 提交下标索引
  let commitLookup: Record<string, number> = {}
  for (let i = 0; i < commits.length; i++) commitLookup[commits[i].hash] = i
  // 4. 合并 stash（两种情况）
  const toInsert: { index: number; data: GitStash }[] = []
  for (const stash of stashes) {
    if (typeof commitLookup[stash.hash] === 'number') {
      // stash 提交本身已在列表中（--reflog 打开时可能发生）：原地标注，不插入
      commits[commitLookup[stash.hash]].stash = {
        selector: stash.selector,
        baseHash: stash.baseHash,
        untrackedFilesHash: stash.untrackedFilesHash
      }
    } else if (typeof commitLookup[stash.baseHash] === 'number') {
      toInsert.push({ index: commitLookup[stash.baseHash], data: stash })
    }
  }
  // index 升序、同 index 按 date 降序，再从尾往头 splice：插入不破坏先前算好的 index，
  // 且同一 base 上的多个 stash 最终按时间新在上排列
  toInsert.sort((a, b) => (a.index !== b.index ? a.index - b.index : b.data.date - a.data.date))
  for (let i = toInsert.length - 1; i >= 0; i--) {
    const stash = toInsert[i].data
    commits.splice(toInsert[i].index, 0, {
      hash: stash.hash,
      parents: [stash.baseHash],
      author: stash.author,
      email: stash.email,
      date: stash.date,
      message: stash.message,
      heads: [],
      tags: [],
      remotes: [],
      stash: {
        selector: stash.selector,
        baseHash: stash.baseHash,
        untrackedFilesHash: stash.untrackedFilesHash
      }
    })
  }
  if (toInsert.length > 0) {
    // 插入挪动了下标，重建整个索引
    commitLookup = {}
    for (let i = 0; i < commits.length; i++) commitLookup[commits[i].hash] = i
  }
  // 5. 标注 heads
  for (const head of refData.heads) {
    if (typeof commitLookup[head.hash] === 'number') {
      commits[commitLookup[head.hash]].heads.push(head.name)
    }
  }
  // 6. 标注 tags（annotated tag 只有 ^{} 解引用行的 hash 会命中已加载提交）
  if (opts.showTags) {
    for (const tag of refData.tags) {
      if (typeof commitLookup[tag.hash] === 'number') {
        commits[commitLookup[tag.hash]].tags.push({ name: tag.name, annotated: tag.annotated })
      }
    }
  }
  // 7. 标注 remotes：remote 为 null 表示所属 remote 已不存在（禁用 push/pull 类操作）
  for (const remoteRef of refData.remotes) {
    if (typeof commitLookup[remoteRef.hash] === 'number') {
      const remote = remotes.find((name) => remoteRef.name.startsWith(`${name}/`)) ?? null
      commits[commitLookup[remoteRef.hash]].remotes.push({ name: remoteRef.name, remote })
    }
  }
  // tag 名去重（annotated tag 的对象行与 ^{} 行同名），供对话框重名校验
  const tags = [...new Set(refData.tags.map((tag) => tag.name))]
  return { commits, moreCommitsAvailable, tags }
}

// —— §7.1 提交详情基础字段 ——

/**
 * 解析 `git show --quiet --format=<GIT_FORMAT_DETAILS>`（data-read.md §7.1）。
 * 整个 stdout 按分隔符 split（不先分行 —— %B 是多行体）；恒 12 字段，
 * 8/9/10 位是 GPG 占位（v1 关闭签名校验，恒为空）。fileChanges 由调用方另行合成。
 */
export function parseDetails(stdout: string): Omit<GitCommitDetails, 'fileChanges'> {
  const parts = stdout.split(GIT_LOG_SEPARATOR)
  if (parts.length < 12) {
    // 损坏输入返回空详情而非抛错（约定：解析器不 throw）
    return {
      hash: '',
      parents: [],
      author: '',
      authorEmail: '',
      authorDate: 0,
      committer: '',
      committerEmail: '',
      committerDate: 0,
      body: ''
    }
  }
  // body：slice(11) 再 join —— 体内万一出现分隔符也能还原；%B 结尾换行产生的尾部空行去掉
  const bodyLines = parts.slice(11).join(GIT_LOG_SEPARATOR).split(EOL_REGEX)
  return {
    hash: parts[0],
    parents: parts[1] !== '' ? parts[1].split(' ') : [],
    author: parts[2],
    authorEmail: parts[3],
    authorDate: parseInt(parts[4], 10),
    committer: parts[5],
    committerEmail: parts[6],
    committerDate: parseInt(parts[7], 10),
    body: stripTrailingBlankLines(bodyLines).join('\n')
  }
}

// —— §8.2 单文件结构化 unified diff ——

/** hunk 头：@@ -old[,n] +new[,n] @@[ 节头]；",n" 缺省表示 1。 */
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/

/** 二进制文件差异的正文标记（如 "Binary files a/x and b/x differ"）。 */
const BINARY_DIFF_REGEX = /^Binary files .* differ$/

/**
 * 逐行状态机解析 unified diff（data-read.md §8.2）：header 行跳过、hunk 头正则含缺省 ",1"、
 * 行号按 context/add/del 推进、"\ No newline at end of file" 附着到上一行、Binary files 检测。
 * 文件路径与状态由调用方提供（§7 已解析出 GitFileChange），diff 正文只贡献 hunks。
 */
export function parseUnifiedDiff(
  stdout: string,
  file: { oldFilePath: string; newFilePath: string; type: GitFileStatus }
): DiffFileData {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLineNo = 0
  let newLineNo = 0
  for (const line of stdout.split(EOL_REGEX)) {
    const header = line.match(HUNK_HEADER_REGEX)
    if (header !== null) {
      current = {
        oldStart: parseInt(header[1], 10),
        oldLines: header[2] !== undefined ? parseInt(header[2], 10) : 1,
        newStart: parseInt(header[3], 10),
        newLines: header[4] !== undefined ? parseInt(header[4], 10) : 1,
        sectionHeader: header[5] ?? '',
        lines: []
      }
      oldLineNo = current.oldStart
      newLineNo = current.newStart
      hunks.push(current)
      continue
    }
    if (current === null) {
      // hunk 外：diff --git / index / --- / +++ / diff-tree 回显的提交 hash 等 header 行
      if (BINARY_DIFF_REGEX.test(line)) {
        return { ...file, binary: true, hunks: [] }
      }
      continue
    }
    const marker = line[0]
    if (marker === ' ') {
      current.lines.push({
        kind: 'context',
        text: line.substring(1),
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++
      })
    } else if (marker === '+') {
      current.lines.push({
        kind: 'add',
        text: line.substring(1),
        oldLineNo: null,
        newLineNo: newLineNo++
      })
    } else if (marker === '-') {
      current.lines.push({
        kind: 'del',
        text: line.substring(1),
        oldLineNo: oldLineNo++,
        newLineNo: null
      })
    } else if (marker === '\\') {
      // "\ No newline at end of file"：附着到上一行
      const last = current.lines[current.lines.length - 1]
      if (last !== undefined) last.noEolAtEnd = true
    } else {
      // 不认识的行（理论上是下一个文件的 header 或结尾空行）：当前 hunk 结束
      current = null
    }
  }
  return { ...file, binary: false, hunks }
}

// —— §9.5 config --list -z ——

/**
 * 解析 `git config --list -z`：按 NUL 分段并丢掉最后的空段；每段第一个 \n 之前是 key、
 * 之后整体是 value（-z 模式下 key 与 value 以 \n 分隔，value 内换行原样保留）。
 */
export function parseConfigListZ(stdout: string): Record<string, string> {
  const config: Record<string, string> = {}
  const segments = stdout.split('\0')
  segments.pop()
  for (const segment of segments) {
    if (segment === '') continue
    // 每段首行是 key、其余行是 value（与原实现一致：按 EOL 分行再 join('\n')，value 内换行归一化）
    const comps = segment.split(EOL_REGEX)
    const key = comps.shift() as string
    config[key] = comps.join('\n')
  }
  return config
}

// —— §9.4 tag 详情 ——

/**
 * 解析 `git for-each-ref refs/tags/<name> --format=<GIT_FORMAT_TAG_DETAILS>`（6 字段）。
 * message 从 contents 中抠掉签名块并去尾部空行；v1 不做 GPG 校验，signed = 签名段非空。
 * tag 不存在时 for-each-ref 以退出码 0 输出空 → 段数不足，返回 null。
 */
export function parseTagDetails(stdout: string): GitTagDetails | null {
  const parts = stdout.split(GIT_LOG_SEPARATOR)
  if (parts.length < 6) return null
  const signature = parts[4]
  // contents（段 5..末尾）内可能含分隔符：join 还原，再抠掉签名块
  const contents = parts.slice(5).join(GIT_LOG_SEPARATOR).replace(signature, '')
  // 轻量 tag 没有 tagger 字段（%(taggerdate:unix) 为空）：日期兜底 0，不让 NaN 过 IPC
  const taggerDate = parseInt(parts[3], 10)
  const email = parts[2]
  return {
    hash: parts[0],
    taggerName: parts[1],
    // %(taggeremail) 形如 "<a@b.c>"：去掉包裹的尖括号
    taggerEmail: email.startsWith('<') && email.endsWith('>') ? email.slice(1, -1) : email,
    taggerDate: Number.isNaN(taggerDate) ? 0 : taggerDate,
    message: stripTrailingBlankLines(contents.split(EOL_REGEX)).join('\n'),
    signed: signature !== ''
  }
}
