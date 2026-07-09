// git 数据读取编排层 —— gitLoad / gitDetails / gitFileDiff / gitTagDetails / gitRepoConfig
// 五个 IPC 入口的 IO 编排。命令输出的解析全部在 git-parse（纯函数），本层只负责选命令、
// 跑进程、串并行与拼装结果；命令口径移植自 vscode-git-graph dataSource.ts（只含读取面）。
// —— 纯参数构造（build* / assembleRepoConfig）与 IO 分离，供测试。

import { readFile, stat } from 'fs/promises'
import { isAbsolute, join } from 'path'
import { execGit, findGit, getErrorMessage, isVersionAtLeast, resolveRepoRoot } from './git-exec'
import {
  assembleCommits,
  countPorcelainStatus,
  EOL_REGEX,
  generateFileChanges,
  GIT_FORMAT_DETAILS,
  GIT_FORMAT_LOG,
  GIT_FORMAT_STASH,
  GIT_FORMAT_TAG_DETAILS,
  parseBranches,
  parseConfigListZ,
  parseDetails,
  parseLog,
  parseNameStatusZ,
  parseNumStatZ,
  parseRefs,
  parseStashes,
  countLinesInBuffer,
  parseStatusFilesZ,
  parseTagDetails,
  parseFileDiff
} from './git-parse'
import type { GitRefData, GitStash } from './git-parse'
import { GIT_INDEX, UNCOMMITTED, imageMimeOf } from '../shared/git'
import type {
  GitDetailsRequest,
  GitDetailsResult,
  GitDiffRequest,
  GitDiffResult,
  GitImageResult,
  GitEffectiveSettings,
  GitFileChange,
  GitLoadOptions,
  GitLoadResult,
  GitOpInProgress,
  GitRepoConfig,
  GitRepoConfigResult,
  GitTagDetailsResult,
  GitUncommittedDetails
} from '../shared/git'

// —— 常量 ——
// --format 模板与 EOL 正则统一引自 git-parse（GIT_FORMAT_*），保证组命令与解析两侧字段序不漂移。

// DevCube 未开放为设置项的原版全局配置，固定为参考实现的默认值（data-read.md §0 表）
/** 展示 origin/HEAD 这类 remote HEAD ref。 */
const SHOW_REMOTE_HEADS = true
/** 合成「未提交的更改」虚拟行。 */
const SHOW_UNCOMMITTED_CHANGES = true
/** show-all 模式下 log 是否加 --tags（把只被 tag 引用的提交也拉进图）。 */
const SHOW_COMMITS_ONLY_REFERENCED_BY_TAGS = true

/** 项目目录不在 git 仓库内时的统一错误文案（正常 UI 流程不会触达，防御性兜底）。 */
const NOT_A_REPO = '该目录不在 Git 仓库内'

// —— 纯参数构造（供测试） ——

/**
 * 构造 git log 参数（data-read.md §6.1 / toolbar-widgets.md §1.8）。
 * includeHead=false 供 HEAD 未出生（空仓库 / orphan 检出）时的重试：此时 HEAD 不可解析，
 * 只列 refs 可见的提交（如 fetch 到的远程分支）。
 */
export function buildLogArgs(
  options: GitLoadOptions,
  settings: GitEffectiveSettings,
  stashBaseHashes: string[],
  remotes: string[],
  includeHead = true
): string[] {
  const args = [
    '-c',
    // 防 GPG 签名文本混进输出；故意不用 --no-show-signature（git ≥ 2.10 才有），config 方式全版本可用
    'log.showSignature=false',
    'log',
    `--max-count=${options.maxCommits + 1}`, // 多请求 1 条做「还有更多」哨兵
    `--format=${GIT_FORMAT_LOG}`,
    `--${settings.commitOrdering}-order`,
    // 损坏引用（指向缺失对象，如 fetch 中断的残留）静默跳过而非 fatal，图谱照常可用
    '--ignore-missing'
  ]
  if (settings.onlyFollowFirstParent) args.push('--first-parent')
  if (options.branches !== null) {
    // 指定了分支筛选：分支名 / --glob= 模式原样透传，此时不加 --branches/--tags/HEAD
    args.push(...options.branches)
  } else {
    args.push('--branches')
    if (settings.showTags && SHOW_COMMITS_ONLY_REFERENCED_BY_TAGS) args.push('--tags')
    if (settings.includeCommitsMentionedByReflogs) args.push('--reflog')
    if (settings.showRemoteBranches) {
      if (settings.hideRemotes.length === 0) {
        args.push('--remotes')
      } else {
        for (const remote of remotes) {
          if (!settings.hideRemotes.includes(remote)) args.push(`--glob=refs/remotes/${remote}`)
        }
      }
    }
    // stash 基点作为起点 revision：保证「只被 stash 引用的提交」也出现在图里
    for (const hash of [...new Set(stashBaseHashes)]) args.push(hash)
    if (includeHead) args.push('HEAD') // detached HEAD 也可见
  }
  args.push('--') // 防 revision 与路径歧义
  return args
}

/** 构造 git show-ref 参数（data-read.md §4）：不显示远程分支时限制 --heads --tags。 */
export function buildShowRefArgs(showRemoteBranches: boolean): string[] {
  return showRemoteBranches
    ? ['show-ref', '-d', '--head']
    : ['show-ref', '--heads', '--tags', '-d', '--head']
}

/**
 * name-status / numstat 共用的 diff 参数构造（data-read.md §7.2）。
 * from === to 时走 diff-tree --root（根提交 / stash 第三父）；to 为空串表示与工作区比较。
 */
export function buildDiffArgs(
  mode: '--name-status' | '--numstat',
  fromHash: string,
  toHash: string
): { args: string[]; diffTree: boolean } {
  if (fromHash === toHash) {
    return {
      args: [
        'diff-tree',
        mode,
        '-r',
        '--root',
        '--find-renames',
        '--diff-filter=AMDR',
        '-z',
        fromHash
      ],
      diffTree: true
    }
  }
  const args = ['diff', mode, '--find-renames', '--diff-filter=AMDR', '-z', fromHash]
  if (toHash !== '') args.push(toHash)
  return { args, diffTree: false }
}

/**
 * 未提交两段列表的 diff 参数构造（风格对齐 buildDiffArgs，口径见 assembleUncommitted）：
 * staged 用 --cached（HEAD↔index）；unstaged 不带 commit 参数（index↔工作区）。
 */
export function buildUncommittedDiffArgs(
  mode: '--name-status' | '--numstat',
  scope: 'staged' | 'unstaged'
): string[] {
  return scope === 'staged'
    ? ['diff', mode, '--cached', '--find-renames', '--diff-filter=AMDR', '-z']
    : ['diff', mode, '--find-renames', '--diff-filter=AMDR', '-z']
}

/** 单文件 unified diff 的命令选择（data-read.md §8.2 命令表）。noIndex 时退出码 1 视为成功。 */
export function buildFileDiffArgs(
  request: GitDiffRequest,
  repoRoot: string
): { args: string[]; noIndex: boolean } {
  const paths =
    request.oldFilePath === request.newFilePath
      ? [request.newFilePath]
      : [request.oldFilePath, request.newFilePath]
  if (request.type === 'U' && request.toHash === UNCOMMITTED) {
    // 工作区的未跟踪文件没有历史版本：--no-index 与 /dev/null 比较（需要绝对路径）
    return {
      args: [
        '-c',
        'core.quotepath=false',
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-index',
        '-U3',
        '--',
        '/dev/null',
        `${repoRoot}/${request.newFilePath}`
      ],
      noIndex: true
    }
  }
  const base = ['-c', 'core.quotepath=false']
  // 以下两个 index 端点分支与 assembleUncommitted 的两段口径一致：
  // 已暂存 = HEAD→index（--cached 默认与 HEAD 比，fromHash 不进 argv）；未暂存 = index→工作区。
  // 未跟踪文件（U）的端点也是 '::index'→'*'，靠前面的 U 分支优先命中 no-index，不会走到这里。
  if (request.toHash === GIT_INDEX) {
    // 已暂存单文件：HEAD↔index
    return {
      args: [
        ...base,
        'diff',
        '--cached',
        '--no-color',
        '--no-ext-diff',
        '--find-renames',
        '-U3',
        '--',
        ...paths
      ],
      noIndex: false
    }
  }
  if (request.fromHash === GIT_INDEX) {
    // 未暂存单文件（to 恒为 '*'）：index↔工作区
    return {
      args: [...base, 'diff', '--no-color', '--no-ext-diff', '-U3', '--', ...paths],
      noIndex: false
    }
  }
  if (request.fromHash === request.toHash) {
    // 提交自身的变更：根提交 / stash 第三父（含其 U 文件，diff 里呈现为 A）
    return {
      args: [
        ...base,
        'diff-tree',
        '--no-color',
        '-p',
        '-r',
        '--root',
        '--find-renames',
        '-U3',
        request.fromHash,
        '--',
        ...paths
      ],
      noIndex: false
    }
  }
  if (request.toHash === UNCOMMITTED) {
    // 与工作区比较（同时含已暂存 + 未暂存，与详情列表口径一致）
    return {
      args: [
        ...base,
        'diff',
        '--no-color',
        '--no-ext-diff',
        '-U3',
        request.fromHash,
        '--',
        ...paths
      ],
      noIndex: false
    }
  }
  return {
    args: [
      ...base,
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--find-renames',
      '--unified=3',
      request.fromHash,
      request.toHash,
      '--',
      ...paths
    ],
    noIndex: false
  }
}

/** 未提交明细的 status 参数（data-read.md §5.2）：-z 下 rename 原路径是独立 NUL 段。 */
export function buildStatusArgs(showUntracked: boolean): string[] {
  return ['status', '-s', `--untracked-files=${showUntracked ? 'all' : 'no'}`, '--porcelain', '-z']
}

/**
 * opInProgress 探测的 gitdir 状态文件（名 → 含义见 resolveOpInProgress）。
 * rev-parse --git-path 一次带全部（逐行输出、顺序与此一致），且在 worktree（.git 为文件）
 * 下也解析到真实 gitdir——直接拼 .git/ 路径不可靠。
 */
const OP_STATE_FILES = [
  'rebase-merge',
  'rebase-apply',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD'
] as const

/** opInProgress 探测的 rev-parse 参数（--git-path 需 git ≥ 2.5，低于仓库所有既有 gate）。 */
export function buildGitPathArgs(): string[] {
  const args = ['rev-parse']
  for (const name of OP_STATE_FILES) args.push('--git-path', name)
  return args
}

/**
 * 存在性标志（与 OP_STATE_FILES 同序）→ 进行中操作。多个并存（变基途中拣选冲突等嵌套）
 * 时按外层优先：rebase > cherry-pick > revert > merge。
 */
export function resolveOpInProgress(exists: boolean[]): GitOpInProgress | null {
  if (exists[0] || exists[1]) return 'rebase' // rebase-merge / rebase-apply（目录）
  if (exists[3]) return 'cherry-pick' // CHERRY_PICK_HEAD
  if (exists[4]) return 'revert' // REVERT_HEAD
  if (exists[2]) return 'merge' // MERGE_HEAD
  return null
}

/**
 * 五路 stdout 组装未提交三段列表（提交面板数据源，ADR-0006）：
 * 已暂存 = HEAD↔index（diff --cached）；未暂存 = index↔工作区（diff）+ status 的未跟踪文件；
 * 冲突（unmerged）= status 的冲突桶（diff 恒 --diff-filter=AMDR，冲突记录只能从 status 取）。
 */
export function assembleUncommitted(
  stagedNS: string,
  stagedNum: string,
  wtNS: string,
  wtNum: string,
  statusStdout: string
): GitUncommittedDetails {
  const status = parseStatusFilesZ(statusStdout)
  const conflictedSet = new Set(status.conflicted)
  return {
    staged: generateFileChanges(
      parseNameStatusZ(stagedNS, false),
      parseNumStatZ(stagedNum, false),
      null
    ),
    // 关键坑：parseStatusFilesZ 的 deleted 混含「暂存删除」（X 位 D）——若透传会把暂存删除
    // 错混进未暂存段；工作区删除（Y 位 D）已由 index↔工作区 diff 自身的 D 记录覆盖，
    // 故 deleted 传空数组、只用 untracked。
    // UU/AA 冲突文件会以 stage-2↔工作区的「影子 M 记录」混进 index↔工作区 diff
    // （numstat 数的是冲突标记行），须按冲突桶剔除，否则同一文件在未暂存段重复成行
    unstaged: generateFileChanges(parseNameStatusZ(wtNS, false), parseNumStatZ(wtNum, false), {
      deleted: [],
      untracked: status.untracked,
      conflicted: []
    }).filter((change) => !conflictedSet.has(change.newFilePath)),
    conflicted: status.conflicted.map((filePath) => ({
      oldFilePath: filePath,
      newFilePath: filePath,
      type: '!' as const,
      additions: null,
      deletions: null
    }))
  }
}

/** 三份 config 列表 + remote 名列表 → GitRepoConfig（data-read.md §9.5）。 */
export function assembleRepoConfig(
  consolidated: Record<string, string>,
  local: Record<string, string>,
  globalCfg: Record<string, string>,
  remotes: string[]
): GitRepoConfig {
  const branches: GitRepoConfig['branches'] = {}
  for (const key of Object.keys(local)) {
    // .+ 贪婪匹配：分支名本身可含 '.'，锚定末尾的已知子键
    const match = key.match(/^branch\.(.+)\.(remote|pushremote|merge|rebase)$/)
    if (match === null) continue
    const entry = branches[match[1]] ?? {
      remote: null,
      pushRemote: null,
      merge: null,
      rebase: null
    }
    if (match[2] === 'remote') entry.remote = local[key]
    else if (match[2] === 'pushremote') entry.pushRemote = local[key]
    else if (match[2] === 'merge') entry.merge = local[key]
    else entry.rebase = local[key]
    branches[match[1]] = entry
  }
  return {
    branches,
    pushDefault: consolidated['remote.pushdefault'] ?? null,
    // pull.rebase 可被全局层覆盖，取合并视图；branch.<name>.rebase 是分支级配置，取 local（见上）
    pullRebase: consolidated['pull.rebase'] ?? null,
    remotes: remotes.map((name) => ({
      name,
      url: local[`remote.${name}.url`] ?? null,
      pushUrl: local[`remote.${name}.pushurl`] ?? null
    })),
    user: {
      name: { local: local['user.name'] ?? null, global: globalCfg['user.name'] ?? null },
      email: { local: local['user.email'] ?? null, global: globalCfg['user.email'] ?? null }
    }
  }
}

// —— IO 辅助 ——

/** 一次成功即取回 utf8 文本的 git 执行结果。 */
type RunResult = { ok: true; stdout: string } | { ok: false; error: string }

/** 跑一条 git 命令：退出码非 0 一律折叠成错误消息（永不 throw）。 */
async function runGit(cwd: string, args: string[]): Promise<RunResult> {
  const result = await execGit(cwd, args)
  if (result.code !== 0) return { ok: false, error: getErrorMessage(result) }
  return { ok: true, stdout: result.stdout.toString('utf8') }
}

/** 按 EOL 分行并去掉结尾换行产生的最后一个空段。 */
function splitLines(stdout: string): string[] {
  const lines = stdout.split(EOL_REGEX)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 读取 stash 列表；任何失败（含无 stash 时 refs/stash 不存在）都吞成 []（data-read.md §3.3）。 */
async function loadStashes(root: string, showStashes: boolean): Promise<GitStash[]> {
  if (!showStashes) return []
  const result = await runGit(root, ['reflog', `--format=${GIT_FORMAT_STASH}`, 'refs/stash', '--'])
  if (!result.ok) return []
  return parseStashes(result.stdout)
}

/**
 * 探测进行中的多步操作：rev-parse --git-path 定位状态文件后逐个 fs 探测存在性。
 * 任何失败（rev-parse 失败 / 行数不符）吞成 null——探测失败不该让整次加载失败。
 */
async function detectOpInProgress(root: string): Promise<GitOpInProgress | null> {
  const result = await runGit(root, buildGitPathArgs())
  if (!result.ok) return null
  const paths = splitLines(result.stdout)
  if (paths.length !== OP_STATE_FILES.length) return null
  const exists = await Promise.all(
    paths.map(async (p) => {
      try {
        // --git-path 输出相对执行时 cwd（即 root），也可能已是绝对路径
        await stat(isAbsolute(p) ? p : join(root, p))
        return true
      } catch {
        return false
      }
    })
  )
  return resolveOpInProgress(exists)
}

/** HEAD 是否已出生（可解析到提交）：-q --verify 保证静默且输出即 hash。 */
function verifyHeadArgs(): string[] {
  return ['rev-parse', '-q', '--verify', 'HEAD']
}

/**
 * show-ref 不可用时的降级 refData：单取 HEAD 提交 hash（unborn / 解析失败为 null），
 * ref 标签留空。show-ref 在空仓库以退出码 1 失败、在存在损坏引用（指向缺失对象）时
 * fatal——两种情况 log 侧都有各自的容错（unborn 路径 / --ignore-missing），图谱与
 * 未提交行照常，仅缺分支 / 标签标注。
 */
async function fallbackRefData(root: string): Promise<GitRefData> {
  const result = await runGit(root, verifyHeadArgs())
  return { head: result.ok ? result.stdout.trim() : null, heads: [], tags: [], remotes: [] }
}

// —— loadRepo：一次完整加载 ——

/** 空骨架上打补丁生成 GitLoadResult，收敛各失败分支的返回。 */
function loadResult(patch: Partial<GitLoadResult>): GitLoadResult {
  return {
    isRepo: false,
    isEmptyRepo: false,
    branches: [],
    remoteBranches: [],
    currentBranch: null,
    remotes: [],
    commits: [],
    headHash: null,
    tags: [],
    moreCommitsAvailable: false,
    opInProgress: null,
    error: null,
    ...patch
  }
}

/**
 * HEAD 未出生（空仓库 / orphan 检出）的加载路径：log 不带 HEAD（fetch 到的远程分支
 * 提交照常入图）+ show-ref + 未提交计数三路并行，未提交行以 unbornHead 口径合成（相对空树、
 * parents 为空），承担首次提交入口。isEmptyRepo = 确实一条提交都没有。
 */
async function loadUnbornHead(
  root: string,
  options: GitLoadOptions,
  settings: GitEffectiveSettings,
  stashes: GitStash[],
  remotes: string[],
  branches: string[],
  remoteBranches: string[],
  currentBranch: string | null,
  opInProgress: GitOpInProgress | null
): Promise<GitLoadResult> {
  const [logRes, refRes, statusRes] = await Promise.all([
    runGit(
      root,
      buildLogArgs(
        options,
        settings,
        stashes.map((s) => s.baseHash),
        remotes,
        false
      )
    ),
    runGit(root, buildShowRefArgs(settings.showRemoteBranches)),
    SHOW_UNCOMMITTED_CHANGES
      ? runGit(root, ['status', '--untracked-files=all', '--porcelain'])
      : Promise.resolve(null)
  ])
  if (!logRes.ok) {
    return loadResult({
      isRepo: true,
      branches,
      remoteBranches,
      currentBranch,
      remotes,
      error: logRes.error
    })
  }
  if (statusRes !== null && !statusRes.ok) {
    return loadResult({
      isRepo: true,
      branches,
      remoteBranches,
      currentBranch,
      remotes,
      error: statusRes.error
    })
  }
  const records = parseLog(logRes.stdout)
  // show-ref 失败（空仓库无任何 ref / 存在损坏引用）：降级路径与主路径同款，
  // HEAD 未出生时 rev-parse 解析不出，head 自然为 null
  const refData: GitRefData = refRes.ok
    ? parseRefs(refRes.stdout, settings.hideRemotes, SHOW_REMOTE_HEADS)
    : await fallbackRefData(root)
  const { commits, moreCommitsAvailable, tags } = assembleCommits(
    records,
    refData,
    stashes,
    remotes,
    {
      maxCommits: options.maxCommits,
      showTags: settings.showTags,
      uncommittedChanges: statusRes !== null ? countPorcelainStatus(statusRes.stdout) : 0,
      unbornHead: true
    }
  )
  return {
    isRepo: true,
    isEmptyRepo: records.length === 0,
    branches,
    remoteBranches,
    currentBranch,
    remotes,
    commits,
    headHash: null,
    tags,
    moreCommitsAvailable,
    opInProgress,
    error: null
  }
}

/**
 * 加载某项目的完整图谱数据（data-read.md §3-§6）：
 * 仓库根 → 并行取分支/远程/贮藏 → 并行取 log/show-ref → 未提交计数 → assembleCommits 收口。
 */
export async function loadRepo(
  projectPath: string,
  options: GitLoadOptions,
  settings: GitEffectiveSettings
): Promise<GitLoadResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) {
    // 区分「不是仓库」与「git 不可用」：git 缺失时 rev-parse 也会失败，要给安装提示而非误报非仓库
    const probe = await execGit(projectPath, ['--version'])
    if (probe.code !== 0) return loadResult({ error: getErrorMessage(probe) })
    return loadResult({})
  }
  // 第一步：分支 / 远程 / 贮藏 / HEAD 出生探测 / 进行中操作探测 并行（stash 失败吞成 []，
  // HEAD 探测失败即未出生，opInProgress 探测失败吞成 null；其余任一失败整体报错）。
  // 恒取 -a：remoteBranches 需要全量远程分支
  const [branchRes, remoteRes, stashes, headRes, opInProgress] = await Promise.all([
    runGit(root, ['branch', '-a', '--no-color']),
    runGit(root, ['remote']),
    loadStashes(root, settings.showStashes),
    runGit(root, verifyHeadArgs()),
    detectOpInProgress(root)
  ])
  if (!branchRes.ok) return loadResult({ isRepo: true, error: branchRes.error })
  if (!remoteRes.ok) return loadResult({ isRepo: true, error: remoteRes.error })
  // 全量解析（零过滤）：remoteBranches 供拉取/推送对话框选分支——被「显示远程分支」开关
  // 或 hideRemotes 过滤掉的 remote 也必须能拉取/推送，展示口径不能限制动作口径
  const parsedAll = parseBranches(branchRes.stdout, [], SHOW_REMOTE_HEADS)
  const currentBranch = parsedAll.head
  const remoteBranches = parsedAll.branches.filter((b) => b.startsWith('remotes/'))
  // 展示用列表（分支筛选下拉）维持原过滤口径：开关关 = 无任何远程项，开 = 按 hideRemotes 剔除
  const branches = settings.showRemoteBranches
    ? parseBranches(branchRes.stdout, settings.hideRemotes, SHOW_REMOTE_HEADS).branches
    : parsedAll.branches.filter((b) => !b.startsWith('remotes/'))
  const remotes = splitLines(remoteRes.stdout)
  // HEAD 未出生（空仓库 / orphan 检出）：log 的 HEAD revision 不可解析，走专用路径。
  // 显式探测而非匹配 log 的错误文案——log 已带 --ignore-missing，不可解析的 HEAD 会被
  // 静默跳过而非报错，错误文案判定（原实现的做法）在此已不成立。
  // options.branches 非 null（指定分支筛选）时 log 参数本就不含 HEAD，照走主路径。
  if (options.branches === null && !headRes.ok) {
    return loadUnbornHead(
      root,
      options,
      settings,
      stashes,
      remotes,
      branches,
      remoteBranches,
      currentBranch,
      opInProgress
    )
  }
  // 第二步：log 与 show-ref 并行
  const [logRes, refRes] = await Promise.all([
    runGit(
      root,
      buildLogArgs(
        options,
        settings,
        stashes.map((s) => s.baseHash),
        remotes
      )
    ),
    runGit(root, buildShowRefArgs(settings.showRemoteBranches))
  ])
  if (!logRes.ok) {
    return loadResult({
      isRepo: true,
      branches,
      remoteBranches,
      currentBranch,
      remotes,
      error: logRes.error
    })
  }
  const records = parseLog(logRes.stdout)
  const refData: GitRefData = refRes.ok
    ? parseRefs(refRes.stdout, settings.hideRemotes, SHOW_REMOTE_HEADS)
    : await fallbackRefData(root)
  // 未提交更改计数：HEAD 在本次加载窗口内（哨兵条除外）才有意义，不在可视范围就不合成虚拟行
  const headHash = refData.head
  let uncommittedChanges = 0
  if (SHOW_UNCOMMITTED_CHANGES && headHash !== null) {
    const headIndex = records.findIndex((r) => r.hash === headHash)
    if (headIndex !== -1 && headIndex < options.maxCommits) {
      const statusRes = await runGit(root, ['status', '--untracked-files=all', '--porcelain'])
      if (!statusRes.ok) {
        return loadResult({
          isRepo: true,
          branches,
          remoteBranches,
          currentBranch,
          remotes,
          error: statusRes.error
        })
      }
      uncommittedChanges = countPorcelainStatus(statusRes.stdout)
    }
  }
  const { commits, moreCommitsAvailable, tags } = assembleCommits(
    records,
    refData,
    stashes,
    remotes,
    {
      maxCommits: options.maxCommits,
      showTags: settings.showTags,
      uncommittedChanges
    }
  )
  return {
    isRepo: true,
    isEmptyRepo: false,
    branches,
    remoteBranches,
    currentBranch,
    remotes,
    commits,
    headHash,
    tags,
    moreCommitsAvailable,
    opInProgress,
    error: null
  }
}

// —— getDetails：提交 / 未提交 / stash 详情与两点比较 ——

/** 未跟踪文件行数补算的大小上限：超过则跳过（保持无统计），防超大文件拖慢未提交刷新。 */
const UNTRACKED_COUNT_MAX_BYTES = 8 * 1024 * 1024

/**
 * 给列表中 status 追加的未跟踪（U）文件补行数（additions=行数、deletions=0）：git 不为
 * untracked 提供 numstat，读工作区文件按 numstat 口径数行；二进制 / 超大 / 读取失败保持
 * null（沿用「二进制无行数」的既有语义）。isDir 目录条目跳过。就地修改传入列表。
 */
async function fillUntrackedLineCounts(root: string, files: GitFileChange[]): Promise<void> {
  await Promise.all(
    files
      .filter((f) => f.type === 'U' && f.isDir !== true && f.additions === null)
      .map(async (f) => {
        try {
          const absPath = join(root, f.newFilePath)
          const info = await stat(absPath)
          if (!info.isFile() || info.size > UNTRACKED_COUNT_MAX_BYTES) return
          const lines = countLinesInBuffer(await readFile(absPath))
          if (lines !== null) {
            f.additions = lines
            f.deletions = 0
          }
        } catch {
          // 读取失败（权限 / 文件已消失）：保持无统计
        }
      })
  )
}

/** 文件变更列表加载结果（name-status + numstat + 可选 status 三路合成）。 */
type FileChangesResult = { ok: true; fileChanges: GitFileChange[] } | { ok: false; error: string }

/**
 * 并行跑 name-status / numstat（statusArgs 非 null 时再加一路 status -z），
 * 合成 GitFileChange[]（data-read.md §7.2-§7.5）。to 为空串表示与工作区比较。
 */
async function loadFileChanges(
  root: string,
  fromHash: string,
  toHash: string,
  statusArgs: string[] | null
): Promise<FileChangesResult> {
  const { args: nameStatusArgs, diffTree } = buildDiffArgs('--name-status', fromHash, toHash)
  const { args: numStatArgs } = buildDiffArgs('--numstat', fromHash, toHash)
  const [nameStatusRes, numStatRes, statusRes] = await Promise.all([
    runGit(root, nameStatusArgs),
    runGit(root, numStatArgs),
    statusArgs !== null ? runGit(root, statusArgs) : Promise.resolve(null)
  ])
  if (!nameStatusRes.ok) return { ok: false, error: nameStatusRes.error }
  if (!numStatRes.ok) return { ok: false, error: numStatRes.error }
  if (statusRes !== null && !statusRes.ok) return { ok: false, error: statusRes.error }
  const statusFiles = statusRes !== null ? parseStatusFilesZ(statusRes.stdout) : null
  const fileChanges = generateFileChanges(
    parseNameStatusZ(nameStatusRes.stdout, diffTree),
    parseNumStatZ(numStatRes.stdout, diffTree),
    statusFiles
  )
  // status 追加的未跟踪文件补行数（仅与工作区比较时存在，其余场景空集零开销）
  await fillUntrackedLineCounts(root, fileChanges)
  return { ok: true, fileChanges }
}

/**
 * 详情四入口（data-read.md §7.6 表）：
 * commit（hasParents 决定 from=hash^）/ uncommitted（已暂存 + 未暂存两段并行合成，ADR-0006）/
 * stash（第三父的未跟踪文件改标 U 追加）/ compare（to='*' 时与工作区比 + status）。
 */
export async function getDetails(
  projectPath: string,
  request: GitDetailsRequest,
  showUntracked: boolean
): Promise<GitDetailsResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null)
    return { details: null, fileChanges: null, uncommitted: null, error: NOT_A_REPO }
  if (request.kind === 'compare') {
    // 比较没有单提交元信息，只有文件变更列表；to='*' 时与工作区比并叠加 status 明细
    const withWorking = request.toHash === UNCOMMITTED
    const result = await loadFileChanges(
      root,
      request.fromHash,
      withWorking ? '' : request.toHash,
      withWorking ? buildStatusArgs(showUntracked) : null
    )
    if (!result.ok) {
      return { details: null, fileChanges: null, uncommitted: null, error: result.error }
    }
    return { details: null, fileChanges: result.fileChanges, uncommitted: null, error: null }
  }
  if (request.kind === 'uncommitted') {
    // 提交面板不需要伪提交元信息（details / fileChanges 恒为 null），
    // 五路并行取两段素材：已暂存 name-status/numstat + 未暂存 name-status/numstat + status
    const [stagedNS, stagedNum, wtNS, wtNum, statusRes] = await Promise.all([
      runGit(root, buildUncommittedDiffArgs('--name-status', 'staged')),
      runGit(root, buildUncommittedDiffArgs('--numstat', 'staged')),
      runGit(root, buildUncommittedDiffArgs('--name-status', 'unstaged')),
      runGit(root, buildUncommittedDiffArgs('--numstat', 'unstaged')),
      runGit(root, buildStatusArgs(showUntracked))
    ])
    if (!stagedNS.ok)
      return { details: null, fileChanges: null, uncommitted: null, error: stagedNS.error }
    if (!stagedNum.ok)
      return { details: null, fileChanges: null, uncommitted: null, error: stagedNum.error }
    if (!wtNS.ok) return { details: null, fileChanges: null, uncommitted: null, error: wtNS.error }
    if (!wtNum.ok)
      return { details: null, fileChanges: null, uncommitted: null, error: wtNum.error }
    if (!statusRes.ok)
      return { details: null, fileChanges: null, uncommitted: null, error: statusRes.error }
    const uncommitted = assembleUncommitted(
      stagedNS.stdout,
      stagedNum.stdout,
      wtNS.stdout,
      wtNum.stdout,
      statusRes.stdout
    )
    // status 追加的未跟踪文件补行数（只会出现在未暂存段）
    await fillUntrackedLineCounts(root, uncommitted.unstaged)
    return { details: null, fileChanges: null, uncommitted, error: null }
  }
  // commit / stash：详情基础（git show --quiet）与文件变更两路（+stash 第三父一路）全部并行
  const fromHash =
    request.kind === 'commit'
      ? request.hasParents
        ? `${request.hash}^`
        : request.hash // 根提交 from===to → buildDiffArgs 走 diff-tree --root
      : request.stash.baseHash
  const untrackedHash = request.kind === 'stash' ? request.stash.untrackedFilesHash : null
  const [showRes, changes, untrackedChanges] = await Promise.all([
    runGit(root, [
      '-c',
      'log.showSignature=false',
      'show',
      '--quiet',
      request.hash,
      `--format=${GIT_FORMAT_DETAILS}`
    ]),
    loadFileChanges(root, fromHash, request.hash, null),
    // stash 第三父提交专存未跟踪文件：from=to 走 diff-tree --root 取其文件列表
    untrackedHash !== null
      ? loadFileChanges(root, untrackedHash, untrackedHash, null)
      : Promise.resolve(null)
  ])
  if (!showRes.ok)
    return { details: null, fileChanges: null, uncommitted: null, error: showRes.error }
  if (!changes.ok)
    return { details: null, fileChanges: null, uncommitted: null, error: changes.error }
  if (untrackedChanges !== null && !untrackedChanges.ok) {
    return { details: null, fileChanges: null, uncommitted: null, error: untrackedChanges.error }
  }
  let fileChanges = changes.fileChanges
  if (untrackedChanges !== null) {
    // 第三父里未跟踪文件在 diff 中呈现为 A，追加进列表时改标 U（data-read.md §7.6）
    fileChanges = fileChanges.concat(
      untrackedChanges.fileChanges
        .filter((change) => change.type === 'A')
        .map((change) => ({ ...change, type: 'U' as const }))
    )
  }
  return {
    details: { ...parseDetails(showRes.stdout), fileChanges },
    fileChanges: null,
    uncommitted: null,
    error: null
  }
}

// —— getFileDiff：单文件 diff（原始 unified diff 文本 + 二进制判定） ——

/** 单文件 diff（data-read.md §8.2）：按场景选命令，stdout 原样交给 parseFileDiff（仅判二进制）。 */
export async function getFileDiff(
  projectPath: string,
  request: GitDiffRequest
): Promise<GitDiffResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) return { diff: null, error: NOT_A_REPO }
  const { args, noIndex } = buildFileDiffArgs(request, root)
  const result = await execGit(root, args)
  // --no-index 有差异时退出码为 1（常态），≥2 或 spawn 失败（-1）才是错误；其余命令非 0 即错
  const failed = noIndex ? result.code < 0 || result.code >= 2 : result.code !== 0
  if (failed) return { diff: null, error: getErrorMessage(result) }
  return {
    diff: parseFileDiff(result.stdout.toString('utf8'), {
      oldFilePath: request.oldFilePath,
      newFilePath: request.newFilePath,
      type: request.type
    }),
    error: null
  }
}

// —— getFileImage：二进制图片的新旧内容（diff 面板预览） ——

/** 图片预览单侧大小上限：超过视为不可预览（该侧为 null），防超大图撑爆 IPC 与内存。 */
const IMAGE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024

/**
 * 读一侧图片内容：UNCOMMITTED 读工作区文件、GIT_INDEX 读暂存区快照、其余 `git show <ref>:<path>`。
 * 对象不存在（新增无旧侧 / 删除无新侧）、超限或读取失败返回 null（侧级容错，不产错误）。
 */
async function readImageSide(root: string, ref: string, path: string): Promise<Buffer | null> {
  if (ref === UNCOMMITTED) {
    try {
      const absPath = join(root, path)
      const info = await stat(absPath)
      if (!info.isFile() || info.size > IMAGE_PREVIEW_MAX_BYTES) return null
      return await readFile(absPath)
    } catch {
      return null
    }
  }
  const spec = ref === GIT_INDEX ? `:0:${path}` : `${ref}:${path}`
  const result = await execGit(root, ['show', spec])
  if (result.code !== 0 || result.stdout.length > IMAGE_PREVIEW_MAX_BYTES) return null
  return result.stdout
}

/**
 * 图片文件的新旧预览数据（data URL）：旧端 = from（「提交自身变更」场景取 hash^，与
 * buildFileDiffArgs 的旧侧语义一致），新端 = to；两侧独立容错，A/U 无旧侧、D 无新侧
 * 自然为 null。MIME 按各侧路径扩展名分别解析（覆盖重命名换扩展名的场景）。
 */
export async function getFileImage(
  projectPath: string,
  request: GitDiffRequest
): Promise<GitImageResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) return { oldDataUrl: null, newDataUrl: null, error: NOT_A_REPO }
  const oldMime = imageMimeOf(request.oldFilePath)
  const newMime = imageMimeOf(request.newFilePath)
  if (oldMime === null && newMime === null) {
    return { oldDataUrl: null, newDataUrl: null, error: '不是可预览的图片文件' }
  }
  const oldRef = request.fromHash === request.toHash ? `${request.fromHash}^` : request.fromHash
  const [oldBuf, newBuf] = await Promise.all([
    oldMime !== null ? readImageSide(root, oldRef, request.oldFilePath) : Promise.resolve(null),
    newMime !== null
      ? readImageSide(root, request.toHash, request.newFilePath)
      : Promise.resolve(null)
  ])
  const toUrl = (buf: Buffer | null, mime: string | null): string | null =>
    buf === null || mime === null ? null : `data:${mime};base64,${buf.toString('base64')}`
  return { oldDataUrl: toUrl(oldBuf, oldMime), newDataUrl: toUrl(newBuf, newMime), error: null }
}

// —— getTagDetails：annotated tag 的消息 ——

/** tag 详情（data-read.md §9.4）：for-each-ref 取 tagger / 消息；需 git ≥ 1.7.8。 */
export async function getTagDetails(
  projectPath: string,
  tagName: string
): Promise<GitTagDetailsResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) return { details: null, error: NOT_A_REPO }
  // 版本 gate：%(contents:signature) 等 for-each-ref 字段 1.7.8 起才有
  // （git 缺失时不在此拦截，让 runGit 返回统一的「未找到 git」错误文案）
  const git = await findGit()
  if (git !== null && !isVersionAtLeast(git.version, '1.7.8')) {
    return {
      details: null,
      error: `此功能需要 Git ≥ 1.7.8，当前安装的是 Git ${git.version}，请升级后使用。`
    }
  }
  const result = await runGit(root, [
    'for-each-ref',
    `refs/tags/${tagName}`,
    `--format=${GIT_FORMAT_TAG_DETAILS}`
  ])
  if (!result.ok) return { details: null, error: result.error }
  const details = parseTagDetails(result.stdout)
  // tag 不存在时 for-each-ref 以退出码 0 输出空 → 解析不出素材，给出明确提示
  if (!details) return { details: null, error: `未找到标签 ${tagName} 的详情` }
  return { details, error: null }
}

// —— getRepoConfig：仓库 git 配置（设置面板用） ——

/** 一份 config 列表；缺配置文件的 fatal（如从未创建 ~/.gitconfig）吞成空对象而非报错。 */
async function loadConfigList(
  root: string,
  location?: '--local' | '--global'
): Promise<{ ok: true; config: Record<string, string> } | { ok: false; error: string }> {
  const args = ['--no-pager', 'config', '--list', '-z', '--includes']
  if (location !== undefined) args.push(location)
  const result = await execGit(root, args)
  if (result.code !== 0) {
    const message = getErrorMessage(result)
    const lower = message.toLowerCase()
    if (
      lower.startsWith('fatal: unable to read config file') &&
      lower.endsWith('no such file or directory')
    ) {
      return { ok: true, config: {} }
    }
    return { ok: false, error: message }
  }
  return { ok: true, config: parseConfigListZ(result.stdout.toString('utf8')) }
}

/** 仓库 git 配置（data-read.md §9.5）：合并 / local / global 三份视图 + remote 名列表并行取。 */
export async function getRepoConfig(projectPath: string): Promise<GitRepoConfigResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) return { config: null, error: NOT_A_REPO }
  const [consolidated, local, globalCfg, remoteRes] = await Promise.all([
    loadConfigList(root),
    loadConfigList(root, '--local'),
    loadConfigList(root, '--global'),
    runGit(root, ['remote'])
  ])
  if (!consolidated.ok) return { config: null, error: consolidated.error }
  if (!local.ok) return { config: null, error: local.error }
  if (!globalCfg.ok) return { config: null, error: globalCfg.error }
  if (!remoteRes.ok) return { config: null, error: remoteRes.error }
  return {
    config: assembleRepoConfig(
      consolidated.config,
      local.config,
      globalCfg.config,
      splitLines(remoteRes.stdout)
    ),
    error: null
  }
}
