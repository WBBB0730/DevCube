// Git 拉取 / 推送的纯逻辑：两张对话框（D5 推送、D10 拉取）的默认值求值链，以及工具栏与
// 提交面板「直接拉取 / 推送」用的动作（= 对话框默认值原样提交，拿不准为 null）。
// 与 React 无关；组件文件受 react-refresh only-export-components 限制不宜导出纯函数，
// 故独立成模块供 GitDialogs / git-store 消费并单测（写法对齐 git-details.ts）。

import type { GitAction, GitPullMode, GitRepoConfig, GitRepoSettings } from '@shared/git'

/** 直接拉取 / 推送要读的仓库快照（git-store 的仓库状态桶即满足）。 */
export interface DirectActionState {
  currentBranch: string | null
  remotes: readonly string[]
  /** 全量远程分支（带 remotes/ 前缀，不受显示开关与 hideRemotes 过滤） */
  remoteBranches: readonly string[]
  config: GitRepoConfig | null
  settings: GitRepoSettings | null
}

/**
 * 拉取 / 推送当前分支时怎么对待「拉取 / 推送时不显示窗口」开关：follow = 照开关（单击），
 * invert = 反过来（按住 ⌘/Ctrl 单击），dialog = 一律打开对话框（提交时勾了「修正」）。
 */
export type SkipDialogMode = 'follow' | 'invert' | 'dialog'

/** 这次是否想直接执行（开关值 + 点法）；想直接执行但拿不准时仍由调用方打开对话框。 */
export function prefersDirect(skipDialog: boolean, mode: SkipDialogMode): boolean {
  return mode !== 'dialog' && skipDialog !== (mode === 'invert')
}

/**
 * push remote 默认值（D5/D13）：branch 的 pushRemote → branch 的 remote → push.default →
 * origin → 第一个 remote。config 未加载（null）时直接走后两级回退。
 */
export function defaultPushRemote(
  branch: string,
  remotes: readonly string[],
  config: GitRepoConfig | null
): string {
  if (remotes.length === 0) return ''
  const bc = config?.branches[branch]
  if (bc !== undefined && bc.pushRemote !== null && remotes.includes(bc.pushRemote)) {
    return bc.pushRemote
  }
  if (bc !== undefined && bc.remote !== null && remotes.includes(bc.remote)) return bc.remote
  const pushDefault = config?.pushDefault ?? null
  if (pushDefault !== null && remotes.includes(pushDefault)) return pushDefault
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

/**
 * pull 对话框「从远程拉取」默认值：当前分支上游 remote（branch.<name>.remote 且仍在
 * remotes 中）→ 第一个 remote。config 未加载（null）/ detached HEAD 时直接取第一个。
 */
export function defaultPullRemote(
  currentBranch: string | null,
  remotes: readonly string[],
  config: GitRepoConfig | null
): string {
  if (remotes.length === 0) return ''
  const configured =
    currentBranch !== null ? (config?.branches[currentBranch]?.remote ?? null) : null
  return configured !== null && remotes.includes(configured) ? configured : remotes[0]
}

/**
 * 某 remote 上已加载的远程分支名（剥掉 remotes/<remote>/ 前缀）。剔除 HEAD：clone 出来的
 * 仓库带 remotes/<remote>/HEAD 符号引用（parseBranches 保留该伪条目），它不是分支——
 * 选中会生成 `git pull <remote> HEAD`（实际拉远程默认分支）或推送到 HEAD 直接报错。
 */
export function remoteBranchesOf(branches: readonly string[], remote: string): string[] {
  const prefix = `remotes/${remote}/`
  return branches
    .filter((b) => b.startsWith(prefix))
    .map((b) => b.substring(prefix.length))
    .filter((name) => name !== 'HEAD')
}

/** 当前分支上游的分支名（branch.<name>.merge 的 refs/heads/X → X）；未配置或不是分支为 null。 */
function upstreamBranchName(
  currentBranch: string | null,
  config: GitRepoConfig | null
): string | null {
  const merge = currentBranch !== null ? (config?.branches[currentBranch]?.merge ?? null) : null
  return merge !== null && merge.startsWith('refs/heads/')
    ? merge.substring('refs/heads/'.length)
    : null
}

/**
 * pull 对话框「远程分支」默认值：上游分支 → 与当前分支同名者 → ''（空值由确认按钮禁用兜底）。
 * 候选须在 options 里才生效。
 */
export function defaultPullBranch(
  currentBranch: string | null,
  options: readonly string[],
  config: GitRepoConfig | null
): string {
  const upstream = upstreamBranchName(currentBranch, config)
  if (upstream !== null && options.includes(upstream)) return upstream
  if (currentBranch !== null && options.includes(currentBranch)) return currentBranch
  return ''
}

/**
 * pull 对话框「整合方式」默认值三层：本仓库的记忆值（GitRepoSettings.pullIntegrationMode）→
 * 仓库 git 配置（branch.<当前分支>.rebase 优先于 pull.rebase，对齐 git 自身的覆盖顺序；
 * true/interactive/merges → 变基，其余 → 合并）→ 合并。
 */
export function defaultPullMode(
  remembered: GitPullMode | null,
  currentBranch: string | null,
  config: GitRepoConfig | null
): GitPullMode {
  if (remembered !== null) return remembered
  const raw =
    (currentBranch !== null ? (config?.branches[currentBranch]?.rebase ?? null) : null) ??
    config?.pullRebase ??
    null
  if (raw === null) return 'merge'
  return ['true', 'interactive', 'merges'].includes(raw.toLowerCase()) ? 'rebase' : 'merge'
}

/**
 * 当前分支的上游（branch.<name>.remote + 上游分支名），且该远程仍在、远程分支仍在已加载的 refs 里；
 * 否则 null（detached HEAD / 无上游 / 上游已删 / config 未加载）。
 */
function upstreamOf(st: DirectActionState): { remote: string; branch: string } | null {
  const remote =
    st.currentBranch !== null ? (st.config?.branches[st.currentBranch]?.remote ?? null) : null
  const branch = upstreamBranchName(st.currentBranch, st.config)
  if (remote === null || branch === null || !st.remotes.includes(remote)) return null
  return remoteBranchesOf(st.remoteBranches, remote).includes(branch) ? { remote, branch } : null
}

/**
 * 「直接拉取」的动作 = 拉取对话框的默认值原样提交：上游 remote 与分支、本仓库记忆的整合方式、
 * 不勾「创建新的合并提交」。只在有上游时成立；拿不准（无上游 / 上游已删 / config 未加载）为 null，
 * 由调用方改弹对话框。
 */
export function directPullAction(
  st: DirectActionState
): Extract<GitAction, { kind: 'pull-branch' }> | null {
  const upstream = upstreamOf(st)
  if (upstream === null) return null
  return {
    kind: 'pull-branch',
    remote: upstream.remote,
    branch: upstream.branch,
    mode: defaultPullMode(st.settings?.pullIntegrationMode ?? null, st.currentBranch, st.config),
    noFastForward: false
  }
}

/**
 * 「直接推送」的动作 = 推送对话框的默认值原样提交：默认推送 remote、与本地同名的目标分支、
 * 设置上游、不推标签、常规模式。只在这组默认值正好指向当前分支的上游（与本地同名、在默认推送
 * remote 上）时成立，否则为 null，由调用方改弹对话框。
 */
export function directPushAction(
  st: DirectActionState
): Extract<GitAction, { kind: 'push-branch' }> | null {
  const upstream = upstreamOf(st)
  if (upstream === null || st.currentBranch === null) return null
  const remote = defaultPushRemote(st.currentBranch, st.remotes, st.config)
  if (remote !== upstream.remote || upstream.branch !== st.currentBranch) return null
  return {
    kind: 'push-branch',
    remote,
    localBranch: st.currentBranch,
    targetBranch: st.currentBranch,
    setUpstream: true,
    pushTags: false,
    mode: 'normal'
  }
}
