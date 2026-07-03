// git 数据读取编排层 —— gitLoad / gitDetails / gitFileDiff / gitTagDetails / gitRepoConfig
// 五个 IPC 入口的 IO 编排。命令输出的解析全部在 git-parse（纯函数），本层只负责选命令、
// 跑进程、串并行与拼装结果；命令口径移植自 vscode-git-graph dataSource.ts（只含读取面）。
// —— 纯参数构造（build* / assembleRepoConfig）与 IO 分离，供测试。

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
  parseStatusFilesZ,
  parseTagDetails,
  parseUnifiedDiff
} from './git-parse'
import type { GitRefData, GitStash } from './git-parse'
import { UNCOMMITTED } from '../shared/git'
import type {
  GitDetailsRequest,
  GitDetailsResult,
  GitDiffRequest,
  GitDiffResult,
  GitEffectiveSettings,
  GitFileChange,
  GitLoadOptions,
  GitLoadResult,
  GitRepoConfig,
  GitRepoConfigResult,
  GitTagDetailsResult
} from '../shared/git'

// —— 常量 ——
// --format 模板与 EOL 正则统一引自 git-parse（GIT_FORMAT_*），保证组命令与解析两侧字段序不漂移。

// Runlet 未开放为设置项的原版全局配置，固定为参考实现的默认值（data-read.md §0 表）
/** 展示 origin/HEAD 这类 remote HEAD ref。 */
const SHOW_REMOTE_HEADS = true
/** 合成「未提交的更改」虚拟行。 */
const SHOW_UNCOMMITTED_CHANGES = true
/** show-all 模式下 log 是否加 --tags（把只被 tag 引用的提交也拉进图）。 */
const SHOW_COMMITS_ONLY_REFERENCED_BY_TAGS = true

/** 项目目录不在 git 仓库内时的统一错误文案（正常 UI 流程不会触达，防御性兜底）。 */
const NOT_A_REPO = '该目录不在 Git 仓库内'

// —— 纯参数构造（供测试） ——

/** 构造 git log 参数（data-read.md §6.1 / toolbar-widgets.md §1.8）。 */
export function buildLogArgs(
  options: GitLoadOptions,
  settings: GitEffectiveSettings,
  stashBaseHashes: string[],
  remotes: string[]
): string[] {
  const args = [
    '-c',
    // 防 GPG 签名文本混进输出；故意不用 --no-show-signature（git ≥ 2.10 才有），config 方式全版本可用
    'log.showSignature=false',
    'log',
    `--max-count=${options.maxCommits + 1}`, // 多请求 1 条做「还有更多」哨兵
    `--format=${GIT_FORMAT_LOG}`,
    `--${settings.commitOrdering}-order`
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
    args.push('HEAD') // detached HEAD 也可见
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

/** 三份 config 列表 + remote 名列表 → GitRepoConfig（data-read.md §9.5）。 */
export function assembleRepoConfig(
  consolidated: Record<string, string>,
  local: Record<string, string>,
  globalCfg: Record<string, string>,
  remotes: string[]
): GitRepoConfig {
  const branches: GitRepoConfig['branches'] = {}
  for (const key of Object.keys(local)) {
    // .+ 贪婪匹配：分支名本身可含 '.'，锚定末尾的 .remote / .pushremote
    const remoteMatch = key.match(/^branch\.(.+)\.remote$/)
    const pushMatch = remoteMatch === null ? key.match(/^branch\.(.+)\.pushremote$/) : null
    const branch = remoteMatch?.[1] ?? pushMatch?.[1]
    if (branch === undefined) continue
    const entry = branches[branch] ?? { remote: null, pushRemote: null }
    if (remoteMatch !== null) entry.remote = local[key]
    else entry.pushRemote = local[key]
    branches[branch] = entry
  }
  return {
    branches,
    pushDefault: consolidated['remote.pushdefault'] ?? null,
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

// —— loadRepo：一次完整加载 ——

/** 空骨架上打补丁生成 GitLoadResult，收敛各失败分支的返回。 */
function loadResult(patch: Partial<GitLoadResult>): GitLoadResult {
  return {
    isRepo: false,
    isEmptyRepo: false,
    branches: [],
    currentBranch: null,
    remotes: [],
    commits: [],
    headHash: null,
    tags: [],
    moreCommitsAvailable: false,
    error: null,
    ...patch
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
  // 第一步：分支 / 远程 / 贮藏并行（stash 失败吞成 []，其余任一失败整体报错）
  const branchArgs = settings.showRemoteBranches
    ? ['branch', '-a', '--no-color']
    : ['branch', '--no-color']
  const [branchRes, remoteRes, stashes] = await Promise.all([
    runGit(root, branchArgs),
    runGit(root, ['remote']),
    loadStashes(root, settings.showStashes)
  ])
  if (!branchRes.ok) return loadResult({ isRepo: true, error: branchRes.error })
  if (!remoteRes.ok) return loadResult({ isRepo: true, error: remoteRes.error })
  const { branches, head: currentBranch } = parseBranches(
    branchRes.stdout,
    settings.hideRemotes,
    SHOW_REMOTE_HEADS
  )
  const remotes = splitLines(remoteRes.stdout)
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
    // 空仓库：log 以 bad revision 'HEAD' 失败且分支列表为空 → 空仓库态而非报错（data-read.md §6.5）。
    // 必须同时校验错误含 "bad revision 'HEAD'"，否则 detached HEAD 等导致 log 失败、分支恰为空时
    // 会误判空仓库、吞掉真实错误（对齐原实现 web/main.ts processLoadCommitsResponse）。
    if (branches.length === 0 && logRes.error.includes("bad revision 'HEAD'")) {
      return loadResult({ isRepo: true, isEmptyRepo: true, remotes })
    }
    return loadResult({ isRepo: true, branches, currentBranch, remotes, error: logRes.error })
  }
  const records = parseLog(logRes.stdout)
  let refData: GitRefData
  if (refRes.ok) {
    refData = parseRefs(refRes.stdout, settings.hideRemotes, SHOW_REMOTE_HEADS)
  } else if (records.length === 0) {
    // show-ref 在空仓库以退出码 1 失败：log 也无提交时用空 refData 兜底继续
    refData = { head: null, heads: [], tags: [], remotes: [] }
  } else {
    return loadResult({ isRepo: true, branches, currentBranch, remotes, error: refRes.error })
  }
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
    currentBranch,
    remotes,
    commits,
    headHash,
    tags,
    moreCommitsAvailable,
    error: null
  }
}

// —— getDetails：提交 / 未提交 / stash 详情与两点比较 ——

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
  return {
    ok: true,
    fileChanges: generateFileChanges(
      parseNameStatusZ(nameStatusRes.stdout, diffTree),
      parseNumStatZ(numStatRes.stdout, diffTree),
      statusFiles
    )
  }
}

/**
 * 详情四入口（data-read.md §7.6 表）：
 * commit（hasParents 决定 from=hash^）/ uncommitted（HEAD→工作区 + status 合成）/
 * stash（第三父的未跟踪文件改标 U 追加）/ compare（to='*' 时与工作区比 + status）。
 */
export async function getDetails(
  projectPath: string,
  request: GitDetailsRequest,
  showUntracked: boolean
): Promise<GitDetailsResult> {
  const root = await resolveRepoRoot(projectPath)
  if (root === null) return { details: null, fileChanges: null, error: NOT_A_REPO }
  if (request.kind === 'compare') {
    // 比较没有单提交元信息，只有文件变更列表；to='*' 时与工作区比并叠加 status 明细
    const withWorking = request.toHash === UNCOMMITTED
    const result = await loadFileChanges(
      root,
      request.fromHash,
      withWorking ? '' : request.toHash,
      withWorking ? buildStatusArgs(showUntracked) : null
    )
    if (!result.ok) return { details: null, fileChanges: null, error: result.error }
    return { details: null, fileChanges: result.fileChanges, error: null }
  }
  if (request.kind === 'uncommitted') {
    const result = await loadFileChanges(root, 'HEAD', '', buildStatusArgs(showUntracked))
    if (!result.ok) return { details: null, fileChanges: null, error: result.error }
    return {
      // 未提交详情没有提交元信息：hash='*'、作者/时间全空，只有 fileChanges
      details: {
        hash: UNCOMMITTED,
        parents: [],
        author: '',
        authorEmail: '',
        authorDate: 0,
        committer: '',
        committerEmail: '',
        committerDate: 0,
        body: '',
        fileChanges: result.fileChanges
      },
      fileChanges: null,
      error: null
    }
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
  if (!showRes.ok) return { details: null, fileChanges: null, error: showRes.error }
  if (!changes.ok) return { details: null, fileChanges: null, error: changes.error }
  if (untrackedChanges !== null && !untrackedChanges.ok) {
    return { details: null, fileChanges: null, error: untrackedChanges.error }
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
    error: null
  }
}

// —— getFileDiff：单文件结构化 unified diff ——

/** 单文件 diff（data-read.md §8.2）：按场景选命令，stdout 交给 parseUnifiedDiff 出 hunks。 */
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
    diff: parseUnifiedDiff(result.stdout.toString('utf8'), {
      oldFilePath: request.oldFilePath,
      newFilePath: request.newFilePath,
      type: request.type
    }),
    error: null
  }
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
