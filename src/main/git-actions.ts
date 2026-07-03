// Git 动作层：执行所有改动仓库状态的 git 命令（移植自 vscode-git-graph 的 dataSource 动作面）。
// 每个动作的参数构造都是导出的纯函数（供测试），IO 编排集中在 runGitAction；
// 失败不 throw，一律以 GitActionResult 判别联合返回。不做 askpass 与 GPG 签名（signCommits/signTags 恒关）。

import type { GitAction, GitActionResult, GitMergeOn } from '../shared/git'

/** 按 kind 收窄的动作类型别名，让各构造函数的入参精确到自己的变体。 */
type ActionOf<K extends GitAction['kind']> = Extract<GitAction, { kind: K }>

// —— 纯参数构造（供测试）：每个函数返回按序执行的命令参数数组序列 ——

// —— 分支 ——

/** checkout-branch：检出本地分支，或从远程分支创建并检出（-b，自动设置 upstream）。 */
export function buildCheckoutBranchArgs(action: ActionOf<'checkout-branch'>): string[][] {
  return action.remoteBranch === null
    ? [['checkout', action.branch]]
    : [['checkout', '-b', action.branch, action.remoteBranch]]
}

/** create-branch：checkout 且非 force 时合并为一条 checkout -b；force 检出需先 branch -f 再检出。 */
export function buildCreateBranchArgs(action: ActionOf<'create-branch'>): string[][] {
  if (action.checkout && !action.force) {
    return [['checkout', '-b', action.name, action.hash]]
  }
  const commands: string[][] = [
    action.force ? ['branch', '-f', action.name, action.hash] : ['branch', action.name, action.hash]
  ]
  // force 覆盖已有分支时无法用 checkout -b，需要在 branch -f 成功后再单独检出
  if (action.checkout && action.force) commands.push(['checkout', action.name])
  return commands
}

/**
 * delete-branch 的本地删除命令。勾选的远程删除不在此序列内：它们按
 * buildDeleteRemoteBranchArgs 逐个执行且中途失败不停止（与其它复合动作不同），见 runDeleteBranch。
 */
export function buildDeleteBranchArgs(action: ActionOf<'delete-branch'>): string[][] {
  return [['branch', action.force ? '-D' : '-d', action.name]]
}

/** delete-remote-branch：推送删除远程分支（失败降级见 buildDeleteRemoteTrackingBranchArgs）。 */
export function buildDeleteRemoteBranchArgs(action: ActionOf<'delete-remote-branch'>): string[][] {
  return [['push', action.remote, '--delete', action.branch]]
}

/** 远程 ref 已不存在时的降级命令：删除本地的远程跟踪分支。 */
export function buildDeleteRemoteTrackingBranchArgs(remote: string, branch: string): string[] {
  return ['branch', '-d', '-r', `${remote}/${branch}`]
}

/** rename-branch：git branch -m 旧名 新名。 */
export function buildRenameBranchArgs(action: ActionOf<'rename-branch'>): string[][] {
  return [['branch', '-m', action.oldName, action.newName]]
}

// —— merge / rebase ——

/** merge：--squash 优先于 --no-ff（else-if），--no-commit 可叠加；squash 自动提交链在运行时串联。 */
export function buildMergeArgs(action: ActionOf<'merge'>): string[][] {
  const args = ['merge', action.obj]
  if (action.squash) args.push('--squash')
  else if (action.noFastForward) args.push('--no-ff')
  if (action.noCommit) args.push('--no-commit')
  return [args]
}

/** rebase（非交互；交互式由渲染端映射到 Terminal，不走本模块）。 */
export function buildRebaseArgs(action: ActionOf<'rebase'>): string[][] {
  const args = ['rebase', action.obj]
  if (action.ignoreDate) args.push('--ignore-date')
  return [args]
}

/** drop-commit：rebase --onto <hash>^ <hash>，把该提交从当前分支历史中抹掉。 */
export function buildDropCommitArgs(action: ActionOf<'drop-commit'>): string[][] {
  return [['rebase', '--onto', `${action.hash}^`, action.hash]]
}

// —— 提交 ——

/** checkout-commit：检出提交进入 detached HEAD（确认交互在渲染端）。 */
export function buildCheckoutCommitArgs(action: ActionOf<'checkout-commit'>): string[][] {
  return [['checkout', action.hash]]
}

/** cherrypick：选项顺序固定为 --no-commit、-x、-m <父序号>、hash（parentIndex 0 表示普通提交）。 */
export function buildCherrypickArgs(action: ActionOf<'cherrypick'>): string[][] {
  const args = ['cherry-pick']
  if (action.noCommit) args.push('--no-commit')
  if (action.recordOrigin) args.push('-x')
  if (action.parentIndex > 0) args.push('-m', String(action.parentIndex))
  args.push(action.hash)
  return [args]
}

/** revert：恒带 --no-edit（否则 git 会尝试打开编辑器导致进程挂起）。 */
export function buildRevertArgs(action: ActionOf<'revert'>): string[][] {
  const args = ['revert', '--no-edit']
  if (action.parentIndex > 0) args.push('-m', String(action.parentIndex))
  args.push(action.hash)
  return [args]
}

/** reset：git reset --<soft|mixed|hard> <commit>。 */
export function buildResetArgs(action: ActionOf<'reset'>): string[][] {
  return [['reset', `--${action.mode}`, action.hash]]
}

/** reset-file：单文件恢复到某版本；filePath 作为独立 argv 传入，无需转义。 */
export function buildResetFileArgs(action: ActionOf<'reset-file'>): string[][] {
  return [['checkout', action.hash, '--', action.filePath]]
}

/** clean-untracked：含目录时是单个参数 -fd，不是两个。 */
export function buildCleanUntrackedArgs(action: ActionOf<'clean-untracked'>): string[][] {
  return [['clean', action.directories ? '-fd' : '-f']]
}

// —— 远程同步 ——

/** fetch：remote 为 null 抓取全部；pruneTags 的前置校验（须同时 prune、版本 gate）在运行时做。 */
export function buildFetchArgs(action: ActionOf<'fetch'>): string[][] {
  const args = ['fetch', action.remote === null ? '--all' : action.remote]
  if (action.prune) args.push('--prune')
  if (action.pruneTags) args.push('--prune-tags')
  return [args]
}

/** push-branch：每个远程一条命令，顺序执行出错即停；空 remotes 的错误在运行时预检。 */
export function buildPushBranchArgs(action: ActionOf<'push-branch'>): string[][] {
  return action.remotes.map((remote) => {
    const args = ['push', remote, action.branch]
    if (action.setUpstream) args.push('--set-upstream')
    if (action.mode !== 'normal') args.push(`--${action.mode}`)
    return args
  })
}

/** fetch-into-local：把远程分支快进到非当前本地分支；非快进需 -f。 */
export function buildFetchIntoLocalArgs(action: ActionOf<'fetch-into-local'>): string[][] {
  const args = ['fetch']
  if (action.force) args.push('-f')
  args.push(action.remote, `${action.remoteBranch}:${action.localBranch}`)
  return [args]
}

/** pull-branch：真正的 git pull（fetch+merge 一体）；squash 自动提交链在运行时串联。 */
export function buildPullBranchArgs(action: ActionOf<'pull-branch'>): string[][] {
  const args = ['pull', action.remote, action.branch]
  if (action.squash) args.push('--squash')
  else if (action.noFastForward) args.push('--no-ff')
  return [args]
}

// —— 标签 ——

/** add-tag：注释标签恒用 -a（不做 GPG 签名）；创建后的推送链在运行时串联。 */
export function buildAddTagArgs(action: ActionOf<'add-tag'>): string[][] {
  const args = ['tag']
  if (action.force) args.push('-f')
  if (action.type === 'lightweight') args.push(action.name)
  else args.push('-a', action.name, '-m', action.message)
  args.push(action.hash)
  return [args]
}

/** delete-tag：先删远程（若勾选，失败即停、本地不删）再删本地。 */
export function buildDeleteTagArgs(action: ActionOf<'delete-tag'>): string[][] {
  const commands: string[][] = []
  if (action.deleteOnRemote !== null) {
    commands.push(['push', action.deleteOnRemote, '--delete', action.name])
  }
  commands.push(['tag', '-d', action.name])
  return commands
}

/** push-tag：每个远程一条 push 命令；「提交不在远程」预检在运行时做（见 buildPushTagCheckArgs）。 */
export function buildPushTagArgs(action: ActionOf<'push-tag'>): string[][] {
  return action.remotes.map((remote) => ['push', remote, action.name])
}

/** push-tag 预检命令：列出包含该提交的远程跟踪分支。 */
export function buildPushTagCheckArgs(commitHash: string): string[] {
  return ['branch', '-r', '--no-color', `--contains=${commitHash}`]
}

// —— 贮藏 ——

/** stash-push：空消息不加 --message；版本 gate（≥ 2.13.2）在运行时做。 */
export function buildStashPushArgs(action: ActionOf<'stash-push'>): string[][] {
  const args = ['stash', 'push']
  if (action.includeUntracked) args.push('--include-untracked')
  if (action.message !== '') args.push('--message', action.message)
  return [args]
}

/** stash-apply：--index = 恢复时同时还原暂存区状态。 */
export function buildStashApplyArgs(action: ActionOf<'stash-apply'>): string[][] {
  const args = ['stash', 'apply']
  if (action.reinstateIndex) args.push('--index')
  args.push(action.selector)
  return [args]
}

/** stash-pop：冲突时 git 应用改动但不删 stash（非 0 退出，错误原样展示）。 */
export function buildStashPopArgs(action: ActionOf<'stash-pop'>): string[][] {
  const args = ['stash', 'pop']
  if (action.reinstateIndex) args.push('--index')
  args.push(action.selector)
  return [args]
}

/** stash-drop：删除贮藏。 */
export function buildStashDropArgs(action: ActionOf<'stash-drop'>): string[][] {
  return [['stash', 'drop', action.selector]]
}

/** stash-branch：从 stash 的基提交建分支、检出、应用并 drop（分支名在 selector 之前）。 */
export function buildStashBranchArgs(action: ActionOf<'stash-branch'>): string[][] {
  return [['stash', 'branch', action.branchName, action.selector]]
}

// —— remote 管理 ——

/** add-remote：add → 可选 set-url --push → 可选 fetch（不带 prune），顺序执行出错即停。 */
export function buildAddRemoteArgs(action: ActionOf<'add-remote'>): string[][] {
  const commands: string[][] = [['remote', 'add', action.name, action.url]]
  if (action.pushUrl !== null) {
    commands.push(['remote', 'set-url', action.name, '--push', action.pushUrl])
  }
  if (action.fetchAfter) commands.push(['fetch', action.name])
  return commands
}

/** delete-remote：同时删掉该远程的所有远程跟踪分支与相关配置。 */
export function buildDeleteRemoteArgs(action: ActionOf<'delete-remote'>): string[][] {
  return [['remote', 'remove', action.name]]
}

/** set-url 的末段参数：删 URL → --delete 旧值；加 URL → --add 新值；改 URL → 新值 旧值。 */
function setUrlTail(oldUrl: string | null, newUrl: string | null): string[] {
  if (newUrl === null) return ['--delete', oldUrl ?? '']
  if (oldUrl === null) return ['--add', newUrl]
  return [newUrl, oldUrl]
}

/** edit-remote：按需 rename → set-url → set-url --push；重命名后一律使用新名字。 */
export function buildEditRemoteArgs(action: ActionOf<'edit-remote'>): string[][] {
  const commands: string[][] = []
  if (action.nameOld !== action.nameNew) {
    commands.push(['remote', 'rename', action.nameOld, action.nameNew])
  }
  if (action.urlOld !== action.urlNew) {
    commands.push([
      'remote',
      'set-url',
      action.nameNew,
      ...setUrlTail(action.urlOld, action.urlNew)
    ])
  }
  if (action.pushUrlOld !== action.pushUrlNew) {
    commands.push([
      'remote',
      'set-url',
      '--push',
      action.nameNew,
      ...setUrlTail(action.pushUrlOld, action.pushUrlNew)
    ])
  }
  return commands
}

/** prune-remote：删除本地存在但远程已不存在的远程跟踪分支。 */
export function buildPruneRemoteArgs(action: ActionOf<'prune-remote'>): string[][] {
  return [['remote', 'prune', action.name]]
}

// —— git 配置 ——

/** set-config：git config --<location> <key> <value>。 */
export function buildSetConfigArgs(action: ActionOf<'set-config'>): string[][] {
  return [['config', `--${action.location}`, action.key, action.value]]
}

/** unset-config：git config --<location> --unset-all <key>。 */
export function buildUnsetConfigArgs(action: ActionOf<'unset-config'>): string[][] {
  return [['config', `--${action.location}`, '--unset-all', action.key]]
}

// —— 纯辅助：消息 / 解析 / 聚合（供测试） ——

/** merge 对象类型 → squash 提交消息里的描述（消息与参考实现一致，是提交历史惯例，不本地化）。 */
const MERGE_ON_LABEL: Record<GitMergeOn, string> = {
  branch: 'branch',
  'remote-tracking': 'remote-tracking branch',
  commit: 'commit'
}

/** squash 自动提交的消息，形如 "Merge branch 'dev'"。 */
export function buildSquashMessage(obj: string, on: GitMergeOn): string {
  return `Merge ${MERGE_ON_LABEL[on]} '${obj}'`
}

/** squash 自动提交命令（有已暂存差异时执行）。 */
export function buildSquashCommitArgs(obj: string, on: GitMergeOn): string[] {
  return ['commit', '-m', buildSquashMessage(obj, on)]
}

/** 从 `git --version` 输出提取版本号（去掉前缀 "git version " 后 trim）。 */
export function parseGitVersion(stdout: string): string {
  return stdout.trim().replace(/^git version /, '')
}

/** 版本 gate 不满足时的错误文案。 */
export function buildVersionGateError(feature: string, required: string, current: string): string {
  return `此功能需要 Git ≥ ${required}（${feature}），当前安装的是 Git ${current}，请升级后重试。`
}

const EOL_REGEX = /\r\n|\r|\n/

/**
 * 解析 `git branch -r --contains` 的输出，返回「不包含该提交」的远程列表。
 * 逐行去掉前两个状态字符、取 " -> " 之前的分支名、忽略括号包裹的 detached 描述行；
 * 某远程包含该提交当且仅当存在以 "<远程名>/" 为前缀的分支名。
 */
export function findRemotesMissingCommit(stdout: string, remotes: string[]): string[] {
  const branchNames = stdout
    .split(EOL_REGEX)
    .filter((line) => line.length > 2)
    .map((line) => line.substring(2).split(' -> ')[0])
    .filter((name) => !/^\(.* .*\)$/.test(name))
  return remotes.filter((remote) => !branchNames.some((name) => name.startsWith(`${remote}/`)))
}

/** 把一串 ErrorInfo（null=成功）归并为动作结果：全部成功 → ok；否则收集所有非 null 错误。 */
export function toActionResult(errors: (string | null)[]): GitActionResult {
  const nonNull = errors.filter((e): e is string => e !== null)
  return nonNull.length === 0 ? { status: 'ok' } : { status: 'error', errors: nonNull }
}

// —— IO 编排 ——

// git-exec 由并行同事实现（签名已在 foundation.md 冻结）。此处用惰性动态 import 而非
// 静态 import：纯参数构造的单测不触发任何 IO，无需在测试期解析该模块；运行期首次调用
// 后缓存，行为与静态 import 等价。集成后可无损改回静态 import。
type GitExecModule = typeof import('./git-exec')
let gitExecCache: GitExecModule | null = null
async function gitExec(): Promise<GitExecModule> {
  if (gitExecCache === null) gitExecCache = await import('./git-exec')
  return gitExecCache
}

/** 正在执行的动作数（可能多项目并发）。 */
let runningActions = 0
/** 最近一次动作结束的时间戳（毫秒），余震窗口的起点。 */
let lastActionEndedAt = 0
/** 动作结束后的余震窗口：动作自身引发的 .git 文件事件可能晚到，这段时间内仍视为「进行中」。 */
const ACTION_AFTERSHOCK_MS = 1500

/** 是否有 git 动作正在执行（含结束后 1500ms 的余震窗口），供 git-watcher 静音自身事件。 */
export function isGitActionRunning(): boolean {
  return runningActions > 0 || Date.now() - lastActionEndedAt < ACTION_AFTERSHOCK_MS
}

/** git 不可用或项目不在仓库内时的统一错误文案。 */
const NOT_A_REPO_ERROR = '该项目不是 Git 仓库，或未找到 git（请安装 Git 或将其加入 PATH）'

/** 执行一条 git 命令并归为 ErrorInfo：null = 成功，string = 给用户看的错误消息。 */
async function run(cwd: string, args: string[]): Promise<string | null> {
  const { execGit, getErrorMessage } = await gitExec()
  const result = await execGit(cwd, args)
  return result.code === 0 ? null : getErrorMessage(result)
}

/** 顺序执行一串命令，任一失败立即停止；返回每步的 ErrorInfo。 */
async function runSequence(cwd: string, commands: string[][]): Promise<(string | null)[]> {
  const results: (string | null)[] = []
  for (const args of commands) {
    const error = await run(cwd, args)
    results.push(error)
    if (error !== null) break
  }
  return results
}

/** 是否有已暂存差异（diff-index HEAD 的 stdout 非空）；命令失败按「无差异」处理。 */
async function hasStagedChanges(cwd: string): Promise<boolean> {
  const { execGit } = await gitExec()
  const result = await execGit(cwd, ['diff-index', 'HEAD'])
  return result.code === 0 && result.stdout.toString('utf8') !== ''
}

/** squash 后若有已暂存差异则自动提交；无差异（对方分支无新内容）视为成功。 */
async function commitSquashIfStagedChangesExist(
  cwd: string,
  obj: string,
  on: GitMergeOn
): Promise<string | null> {
  if (!(await hasStagedChanges(cwd))) return null
  return run(cwd, buildSquashCommitArgs(obj, on))
}

/**
 * 版本 gate：不满足返回中文错误消息。取不到版本时按满足处理（fail-open——
 * 若 git 整体不可用，后续实际命令自会以错误返回）。
 */
async function checkGitVersion(
  cwd: string,
  required: string,
  feature: string
): Promise<string | null> {
  const { execGit, isVersionAtLeast } = await gitExec()
  const result = await execGit(cwd, ['--version'])
  if (result.code !== 0) return null
  const version = parseGitVersion(result.stdout.toString('utf8'))
  return isVersionAtLeast(version, required)
    ? null
    : buildVersionGateError(feature, required, version)
}

/** 删除远程分支：远程 ref 已不存在时降级为删除本地的远程跟踪分支（静默成功）。 */
async function deleteRemoteBranchStep(
  cwd: string,
  branch: string,
  remote: string
): Promise<string | null> {
  const pushError = await run(
    cwd,
    buildDeleteRemoteBranchArgs({ kind: 'delete-remote-branch', branch, remote })[0]
  )
  if (pushError !== null && /remote ref does not exist/i.test(pushError)) {
    const fallbackError = await run(cwd, buildDeleteRemoteTrackingBranchArgs(remote, branch))
    return fallbackError === null
      ? null
      : `远程上不存在该分支，改为删除远程跟踪分支 ${remote}/${branch}。\n${fallbackError}`
  }
  return pushError
}

/** delete-branch：本地删除成功后逐个删远程分支；远程循环中途失败不停止（参考实现语义）。 */
async function runDeleteBranch(
  cwd: string,
  action: ActionOf<'delete-branch'>
): Promise<GitActionResult> {
  const errors: (string | null)[] = []
  const localError = await run(cwd, buildDeleteBranchArgs(action)[0])
  errors.push(localError)
  if (localError === null) {
    for (const remote of action.deleteOnRemotes) {
      errors.push(await deleteRemoteBranchStep(cwd, action.name, remote))
    }
  }
  return toActionResult(errors)
}

/** merge：成功且 squash 且非 noCommit 时串联 squash 自动提交链。 */
async function runMerge(cwd: string, action: ActionOf<'merge'>): Promise<GitActionResult> {
  const mergeError = await run(cwd, buildMergeArgs(action)[0])
  if (mergeError !== null) return toActionResult([mergeError])
  if (action.squash && !action.noCommit) {
    return toActionResult([await commitSquashIfStagedChangesExist(cwd, action.obj, action.on)])
  }
  return { status: 'ok' }
}

/** pull-branch：成功且 squash 时串联自动提交，消息对象为 "<remote>/<branch>"、类型恒为 branch。 */
async function runPullBranch(
  cwd: string,
  action: ActionOf<'pull-branch'>
): Promise<GitActionResult> {
  const pullError = await run(cwd, buildPullBranchArgs(action)[0])
  if (pullError !== null) return toActionResult([pullError])
  if (action.squash) {
    const obj = `${action.remote}/${action.branch}`
    return toActionResult([await commitSquashIfStagedChangesExist(cwd, obj, 'branch')])
  }
  return { status: 'ok' }
}

/** fetch：pruneTags 的两个前置校验（须同时 prune、git ≥ 2.17.0）不通过时不执行命令。 */
async function runFetch(cwd: string, action: ActionOf<'fetch'>): Promise<GitActionResult> {
  if (action.pruneTags) {
    if (!action.prune) {
      return {
        status: 'error',
        errors: ['清理标签（prune tags）必须同时启用清理远程失效分支（prune）。']
      }
    }
    const gateError = await checkGitVersion(cwd, '2.17.0', 'fetch --prune-tags')
    if (gateError !== null) return { status: 'error', errors: [gateError] }
  }
  return toActionResult(await runSequence(cwd, buildFetchArgs(action)))
}

/** push-branch：空 remotes 直接报错；逐个远程推送，出错即停。 */
async function runPushBranch(
  cwd: string,
  action: ActionOf<'push-branch'>
): Promise<GitActionResult> {
  if (action.remotes.length === 0) {
    return { status: 'error', errors: [`未指定要推送分支 ${action.branch} 的远程。`] }
  }
  return toActionResult(await runSequence(cwd, buildPushBranchArgs(action)))
}

/**
 * push-tag 的共用流程（add-tag 的推送链也走这里）：skipRemoteCheck=false 时先预检
 * 提交是否已在各远程，缺失则返回 push-tag-not-on-remote 且不执行 push；
 * 预检命令本身失败视为全部远程都包含（fail-open，不阻断推送）。
 */
async function runPushTag(
  cwd: string,
  name: string,
  remotes: string[],
  commitHash: string,
  skipRemoteCheck: boolean
): Promise<GitActionResult> {
  if (remotes.length === 0) {
    return { status: 'error', errors: [`未指定要推送标签 ${name} 的远程。`] }
  }
  if (!skipRemoteCheck) {
    const { execGit } = await gitExec()
    const check = await execGit(cwd, buildPushTagCheckArgs(commitHash))
    if (check.code === 0) {
      const missing = findRemotesMissingCommit(check.stdout.toString('utf8'), remotes)
      if (missing.length > 0) return { status: 'push-tag-not-on-remote', remotes: missing }
    }
  }
  return toActionResult(
    await runSequence(
      cwd,
      remotes.map((remote) => ['push', remote, name])
    )
  )
}

/**
 * add-tag：创建成功且选择了远程时立即推送。推送阶段沿用动作携带的 skipRemoteCheck
 * （透传用户「总是继续」偏好）；预检失败按 push-tag-not-on-remote 返回，渲染端确认后重发。
 */
async function runAddTag(cwd: string, action: ActionOf<'add-tag'>): Promise<GitActionResult> {
  const tagError = await run(cwd, buildAddTagArgs(action)[0])
  if (tagError !== null) return toActionResult([tagError])
  if (action.pushToRemote !== null) {
    return runPushTag(cwd, action.name, [action.pushToRemote], action.hash, action.skipRemoteCheck)
  }
  return { status: 'ok' }
}

/** stash-push：git ≥ 2.13.2 版本 gate 不满足时不执行命令。 */
async function runStashPush(cwd: string, action: ActionOf<'stash-push'>): Promise<GitActionResult> {
  const gateError = await checkGitVersion(cwd, '2.13.2', 'stash push')
  if (gateError !== null) return { status: 'error', errors: [gateError] }
  return toActionResult(await runSequence(cwd, buildStashPushArgs(action)))
}

/** 按动作类型分发执行；简单动作 = 构造出的命令序列顺序执行、出错即停。 */
async function execAction(cwd: string, action: GitAction): Promise<GitActionResult> {
  switch (action.kind) {
    case 'checkout-branch':
      return toActionResult(await runSequence(cwd, buildCheckoutBranchArgs(action)))
    case 'create-branch':
      return toActionResult(await runSequence(cwd, buildCreateBranchArgs(action)))
    case 'delete-branch':
      return runDeleteBranch(cwd, action)
    case 'delete-remote-branch':
      return toActionResult([await deleteRemoteBranchStep(cwd, action.branch, action.remote)])
    case 'rename-branch':
      return toActionResult(await runSequence(cwd, buildRenameBranchArgs(action)))
    case 'merge':
      return runMerge(cwd, action)
    case 'rebase':
      return toActionResult(await runSequence(cwd, buildRebaseArgs(action)))
    case 'drop-commit':
      return toActionResult(await runSequence(cwd, buildDropCommitArgs(action)))
    case 'checkout-commit':
      return toActionResult(await runSequence(cwd, buildCheckoutCommitArgs(action)))
    case 'cherrypick':
      return toActionResult(await runSequence(cwd, buildCherrypickArgs(action)))
    case 'revert':
      return toActionResult(await runSequence(cwd, buildRevertArgs(action)))
    case 'reset':
      return toActionResult(await runSequence(cwd, buildResetArgs(action)))
    case 'reset-file':
      return toActionResult(await runSequence(cwd, buildResetFileArgs(action)))
    case 'clean-untracked':
      return toActionResult(await runSequence(cwd, buildCleanUntrackedArgs(action)))
    case 'fetch':
      return runFetch(cwd, action)
    case 'push-branch':
      return runPushBranch(cwd, action)
    case 'fetch-into-local':
      return toActionResult(await runSequence(cwd, buildFetchIntoLocalArgs(action)))
    case 'pull-branch':
      return runPullBranch(cwd, action)
    case 'add-tag':
      return runAddTag(cwd, action)
    case 'delete-tag':
      return toActionResult(await runSequence(cwd, buildDeleteTagArgs(action)))
    case 'push-tag':
      return runPushTag(cwd, action.name, action.remotes, action.commitHash, action.skipRemoteCheck)
    case 'stash-push':
      return runStashPush(cwd, action)
    case 'stash-apply':
      return toActionResult(await runSequence(cwd, buildStashApplyArgs(action)))
    case 'stash-pop':
      return toActionResult(await runSequence(cwd, buildStashPopArgs(action)))
    case 'stash-drop':
      return toActionResult(await runSequence(cwd, buildStashDropArgs(action)))
    case 'stash-branch':
      return toActionResult(await runSequence(cwd, buildStashBranchArgs(action)))
    case 'add-remote':
      return toActionResult(await runSequence(cwd, buildAddRemoteArgs(action)))
    case 'delete-remote':
      return toActionResult(await runSequence(cwd, buildDeleteRemoteArgs(action)))
    case 'edit-remote':
      return toActionResult(await runSequence(cwd, buildEditRemoteArgs(action)))
    case 'prune-remote':
      return toActionResult(await runSequence(cwd, buildPruneRemoteArgs(action)))
    case 'set-config':
      return toActionResult(await runSequence(cwd, buildSetConfigArgs(action)))
    case 'unset-config':
      return toActionResult(await runSequence(cwd, buildUnsetConfigArgs(action)))
  }
}

/**
 * 执行一个写动作：解析仓库根 → 分发执行 → 归并结果。执行期间（含结束后 1500ms 余震窗口）
 * isGitActionRunning() 为 true，git-watcher 据此丢弃动作自身引发的文件事件。
 */
export async function runGitAction(
  projectPath: string,
  action: GitAction
): Promise<GitActionResult> {
  runningActions++
  try {
    const { resolveRepoRoot } = await gitExec()
    const repoRoot = await resolveRepoRoot(projectPath)
    if (repoRoot === null) return { status: 'error', errors: [NOT_A_REPO_ERROR] }
    return await execAction(repoRoot, action)
  } finally {
    runningActions--
    lastActionEndedAt = Date.now()
  }
}
