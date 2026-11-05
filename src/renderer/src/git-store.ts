// Git 图谱的渲染端 store：每仓库一桶状态（提交/refs + 打开中的详情、diff、菜单、对话框）、每项目的仓库清单与选中
// （docs/prd/git-nested-repos.md）+ 跨项目视图偏好。桶的键是 GitRepo.path（项目自己的仓库即项目路径）。
// GitRepoState / GitStoreState 契约最初冻结于 foundation.md §D（E/F/G 组件按此消费），
// 之后随产品演进有序扩展（如 fetching / refresh：工具栏「刷新 = fetch + 软重载」）；
// 改字段与方法签名仍需同步全部消费方。
// 刷新语义照 watch-refresh 规格：软刷新保持 ready 原地换数据（数据未变时连 commits 数组引用都不换，
// 行组件 memo 即零重渲染）；硬刷新清空后进 loading；过期响应用代际号静默丢弃。

import { create } from 'zustand'
import {
  DEFAULT_GIT_VIEW_PREFS,
  GIT_DEFAULTS,
  UNCOMMITTED,
  pickSelectedRepo,
  type GitAction,
  type GitActionResult,
  type GitCommit,
  type GitCommitStash,
  type GitDetailsRequest,
  type GitFileChange,
  type GitOpInProgress,
  type GitRepo,
  type GitRepoConfig,
  type GitRepoSettings,
  type GitViewPrefs,
  type GitWorktree
} from '@shared/git'
import { gitTaskTitle } from '@shared/git-task'
import type {
  GitContextMenuState,
  GitDialogRequest,
  GitDiffViewState,
  GitExpandedState,
  GitFindState,
  GitMenuTarget
} from '@renderer/components/git/git-view-types'
import { reconcileDiffView } from '@renderer/components/git/git-details'
import {
  directPullAction,
  directPushAction,
  prefersDirect,
  type SkipDialogMode
} from '@renderer/components/git/git-pull-push'
import { childPathPrefix, normalizePath } from '@shared/files-path'
import { findSeed } from '@renderer/lib/find-seed'
import { useApp } from '@renderer/store'
import { useFiles } from '@renderer/files-store'

/** 单个仓库的 Git 图谱状态桶（冻结契约，foundation.md §D）。 */
export interface GitRepoState {
  /** loading 仅硬刷新（清空后重拉）；软刷新保持 ready 原地换数据 */
  status: 'idle' | 'loading' | 'ready' | 'error'
  isRepo: boolean
  isEmptyRepo: boolean
  commits: GitCommit[]
  headHash: string | null
  currentBranch: string | null
  branches: string[]
  /** 全量远程分支（带 remotes/ 前缀，不受显示开关与 hideRemotes 过滤），拉取/推送对话框用 */
  remoteBranches: string[]
  remotes: string[]
  tags: string[]
  moreCommitsAvailable: boolean
  /** 进行中的多步操作（变基/合并/拣选/回滚，冲突中断等）；状态条与防误触置灰依据 */
  opInProgress: GitOpInProgress | null
  /** 同仓库的全部工作树（含本仓库目录所在）；工作树下拉与分支占用标注的数据源 */
  worktrees: GitWorktree[]
  loadError: string | null
  /** 本次加载的提交窗口上限；初始 GIT_DEFAULTS.initialLoadCommits，「加载更多」+100 */
  maxCommits: number
  /** 分支筛选：null = 显示全部 */
  branchFilter: string[] | null
  /** 每仓库持久化设置（首次 load 时拉取；null = 尚未取到） */
  settings: GitRepoSettings | null
  /** 仓库 git 配置快照（设置面板按需 loadRepoConfig；null = 尚未取到） */
  config: GitRepoConfig | null
  /** 展开中的提交详情（含比较模式）；null = 未展开 */
  expanded: GitExpandedState | null
  /** 打开中的单文件 diff；null = 未打开 */
  diffView: GitDiffViewState | null
  /** 打开中的右键菜单；null = 未打开 */
  contextMenu: GitContextMenuState | null
  /** 打开中的对话框请求；null = 未打开 */
  dialog: GitDialogRequest | null
  /** 查找组件状态；null = 从未打开 */
  find: GitFindState | null
  /** 动作进行中的文案（如「正在检出分支」）；null = 空闲 */
  actionRunning: string | null
  /** 动作失败的错误列表（错误框展示）；null = 无错误 */
  actionErrors: string[] | null
  /** 「刷新 = fetch + 软重载」的 fetch 进行中标记（工具栏刷新钮转圈用，不弹进行中遮罩） */
  fetching: boolean
  /**
   * 图谱级重载中标记（切分支筛选 / 改视图开关）：保持工具栏与 ready 布局，仅在图谱区盖
   * loading 遮罩，不走硬刷新的「清空 + 全局 loading」（那会连工具栏一起闪没）
   */
  graphLoading: boolean
  /**
   * 提交面板草稿（提交信息 + 修正勾选 + 勾选「修正」前的原信息备份，供取消勾选时恢复）：
   * 随桶常驻（切走/收起不丢）、不持久化
   */
  commitDraft: { message: string; amend: boolean; preAmendMessage: string }
}

/** 一个项目的仓库清单与选中（Git Tab 仓库下拉）。 */
export interface GitProjectRepos {
  /** 项目自己的仓库（有则排第一个）+ 嵌套仓库与子模块 */
  list: GitRepo[]
  /** 选中的仓库（GitRepo.path）；清单为空为 null */
  selected: string | null
}

/** Git store 全量形状（冻结契约）。除仓库清单的两个方法按项目外，方法均以 repoPath 为第一参定位状态桶。 */
export interface GitStoreState {
  repos: Record<string, GitRepoState>
  /** 每项目的仓库清单与选中（键 = 项目路径；没取过清单为缺省） */
  projectRepos: Record<string, GitProjectRepos>
  viewPrefs: GitViewPrefs
  /**
   * 取 / 重取项目的仓库清单：第一次连同记住的选中一并取；选中的仓库不在了按 pickSelectedRepo 换一个；
   * 选中的仓库从未加载过就加载它
   */
  loadRepos(projectPath: string): Promise<void>
  /** 选中项目里的某个仓库：记住它（跨重启），从未加载过就加载 */
  selectRepo(projectPath: string, repoPath: string): void
  /** 加载/刷新某仓库：默认软刷新（ready 原地换数据）；hard=true 清空后 loading 重拉 */
  load(repoPath: string, opts?: { hard?: boolean }): Promise<void>
  /**
   * 刷新（工具栏刷新钮 / ⌘R / 自动获取）：先软刷新本地图谱，再静默 fetch 全部远程并把远程 ref
   * 软刷进图；在途则跳过。suppressErrorBox：fetch 失败不弹错误框（自动获取用，网络不通不打扰）
   */
  refresh(repoPath: string, opts?: { suppressErrorBox?: boolean }): Promise<void>
  /** 「加载更多」：maxCommits += loadMoreCommits 后软刷新；有在途请求时幂等跳过 */
  loadMore(repoPath: string): Promise<void>
  /** 切换分支筛选：重置 maxCommits 并硬刷新 */
  setBranchFilter(repoPath: string, branches: string[] | null): Promise<void>
  /** 写每仓库设置（返回权威快照落桶）；数据可见性开关变化时硬刷新 */
  updateSettings(repoPath: string, patch: Partial<GitRepoSettings>): Promise<void>
  /** 拉取仓库 git 配置（设置面板打开时按需调用） */
  loadRepoConfig(repoPath: string): Promise<void>
  /** 写跨项目视图偏好（返回权威快照） */
  setViewPrefs(patch: Partial<GitViewPrefs>): Promise<void>
  /** 打开提交/未提交/stash 详情（普通模式）；数据异步回填到 expanded */
  openDetails(repoPath: string, hash: string, stash: GitCommitStash | null): Promise<void>
  /** 打开两提交比较；请求前按行序归一化 from=较老一方 */
  openCompare(repoPath: string, hashA: string, hashB: string): Promise<void>
  closeDetails(repoPath: string): void
  /** 打开单文件 diff（from/to 由调用方按「from=较老」传入）；keepContent 时保留旧正文直到新数据落地 */
  openDiff(
    repoPath: string,
    file: GitFileChange,
    fromHash: string,
    toHash: string,
    opts?: { keepContent?: boolean }
  ): Promise<void>
  closeDiff(repoPath: string): void
  openContextMenu(repoPath: string, menu: GitContextMenuState): void
  closeContextMenu(repoPath: string): void
  openDialog(repoPath: string, req: GitDialogRequest): void
  closeDialog(repoPath: string): void
  /**
   * 拉取当前分支（工具栏拉取钮）：按点法与「拉取时不显示窗口」开关想直接执行、且默认值指向上游时
   * 直接拉取（= 对话框默认值原样提交），否则打开带开关勾选的拉取对话框。
   */
  pullCurrentBranch(repoPath: string, mode: SkipDialogMode): void
  /** 推送当前分支（工具栏推送钮、提交并推送）：规则同 pullCurrentBranch，开关为「推送时不显示窗口」。 */
  pushCurrentBranch(repoPath: string, mode: SkipDialogMode): void
  /** 更新查找状态：patch 合并；传 null 整体关闭并清空 */
  setFind(repoPath: string, patch: Partial<GitFindState> | null): void
  /** 打开查找（⌘F / 工具栏查找钮；已开则重新聚焦）：selection 为选中的文字，可预填时替换查询（见 findSeed） */
  openFind(repoPath: string, selection?: string): void
  clearActionErrors(repoPath: string): void
  /**
   * 执行写动作：置 actionRunning=label → gitAction → ok 软刷新收口 / error 落 actionErrors / push-tag 预检原样返回。
   * 联网动作（Task）不置 actionRunning、失败不落 actionErrors：进度与失败由任务登记处呈现
   */
  runAction(repoPath: string, action: GitAction, label: string): Promise<GitActionResult>
  /**
   * 静默动作（暂存 / 取消暂存 / 撤销 / 提交专用，PRD「静默即时」）：不置 actionRunning
   * （无进行中遮罩），每仓库 FIFO 串行执行；'ok' 软刷新原地换数据，'error' 落 actionErrors。
   * suppressErrorBox：错误不落 actionErrors，由调用方消费返回值就地呈现——对话框内的
   * 行内刷新用（全局错误框会按渲染优先级顶掉表单，卸载后用户已填状态全部丢失）
   */
  runQuietAction(
    repoPath: string,
    action: GitAction,
    opts?: { suppressErrorBox?: boolean }
  ): Promise<GitActionResult>
  /** 写提交面板草稿（浅合并写回） */
  setCommitDraft(repoPath: string, patch: Partial<GitRepoState['commitDraft']>): void
}

/** 未加载仓库的默认空态（稳定引用，供 selector 复用避免无谓重渲染）。 */
const EMPTY_REPO: GitRepoState = {
  status: 'idle',
  isRepo: false,
  isEmptyRepo: false,
  commits: [],
  headHash: null,
  currentBranch: null,
  branches: [],
  remoteBranches: [],
  remotes: [],
  tags: [],
  moreCommitsAvailable: false,
  opInProgress: null,
  worktrees: [],
  loadError: null,
  maxCommits: GIT_DEFAULTS.initialLoadCommits,
  branchFilter: null,
  settings: null,
  config: null,
  expanded: null,
  diffView: null,
  contextMenu: null,
  dialog: null,
  find: null,
  actionRunning: null,
  actionErrors: null,
  fetching: false,
  graphLoading: false,
  commitDraft: { message: '', amend: false, preAmendMessage: '' }
}

/** 取某仓库的状态桶；从未加载过则返回稳定的默认空态。 */
export function gitState(s: GitStoreState, repoPath: string): GitRepoState {
  return s.repos[repoPath] ?? EMPTY_REPO
}

/** 项目选中的仓库（GitRepo.path）；清单没取过或为空为 null。 */
export function selectedRepoPathOf(s: GitStoreState, projectPath: string): string | null {
  return s.projectRepos[projectPath]?.selected ?? null
}

/**
 * 仓库所在的项目与它在清单里的条目（打开文件、开终端、找回 Task 用）：先看当前项目，再按左树顺序找
 * 清单里有它的项目。同一个仓库可以同时在几个项目里（嵌套仓库所在目录也登记成了项目）。
 */
export function repoContextOf(repoPath: string): { projectPath: string; repo: GitRepo } | null {
  const { currentEntryKey, tree } = useApp.getState()
  return findRepoContext(
    useGit.getState().projectRepos,
    [currentEntryKey, ...tree.map((n) => n.project.path)],
    repoPath
  )
}

/** repoContextOf 的纯函数版：按 projectPaths 的顺序找清单里有这个仓库的第一个项目（供组件按订阅到的状态算）。 */
export function findRepoContext(
  projectRepos: Record<string, GitProjectRepos>,
  projectPaths: readonly (string | null)[],
  repoPath: string
): { projectPath: string; repo: GitRepo } | null {
  for (const projectPath of projectPaths) {
    if (projectPath === null) continue
    const repo = projectRepos[projectPath]?.list.find((r) => r.path === repoPath)
    if (repo !== undefined) return { projectPath, repo }
  }
  return null
}

/** 仓库根目录（`/` 分隔，git 给出的文件路径都相对它）；还不在任何项目的清单里时按 repoPath 算。 */
export function repoRootOf(repoPath: string): string {
  return repoContextOf(repoPath)?.repo.root ?? repoPath
}

/** 仓库里一个文件的绝对路径（relPath 相对仓库根，即 git 给出的路径）。 */
export function repoFilePath(repoPath: string, relPath: string): string {
  return `${repoRootOf(repoPath)}/${relPath}`
}

/**
 * 在仓库所在项目的 Files Tab 打开路径（文件或文件夹）。项目是仓库的子目录时，项目外的文件不在
 * Files Tab 的树里，打不开，什么也不做。
 */
export function openInProjectFiles(repoPath: string, absolutePath: string): void {
  const ctx = repoContextOf(repoPath)
  if (ctx === null) return
  const path = normalizePath(absolutePath)
  const root = normalizePath(ctx.projectPath)
  if (path !== root && !path.startsWith(childPathPrefix(root))) return
  useFiles.getState().openInFiles(ctx.projectPath, path)
}

/**
 * 打开在项目根初始化仓库的对话框（非仓库页的按钮与仓库下拉共用）：预填当前生效的 init.defaultBranch
 * （未配置回落 main），拿到后再弹；对话框开在项目路径那一桶上。
 */
export function openInitDialog(projectPath: string): void {
  void window.api.gitDefaultBranch(projectPath).then((defaultBranch) => {
    useGit.getState().openDialog(projectPath, { kind: 'init', defaultBranch })
  })
}

// —— 私有辅助（纯函数） ——

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * 软刷新数据 diff（watch-refresh §2.6）：逐条比较 hash / parents / heads / tags / remotes /
 * stash.selector。刻意不比较 message 与 date —— 真提交同 hash 即同内容，而未提交行的
 * 变更计数与合成时间每次刷新都会变，单独走「只换第 0 条」路径。
 */
function sameCommits(a: GitCommit[], b: GitCommit[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.hash !== y.hash) return false
    if (!sameStrings(x.parents, y.parents) || !sameStrings(x.heads, y.heads)) return false
    if (
      x.tags.length !== y.tags.length ||
      x.tags.some((t, j) => t.name !== y.tags[j].name || t.annotated !== y.tags[j].annotated)
    ) {
      return false
    }
    if (
      x.remotes.length !== y.remotes.length ||
      x.remotes.some((r, j) => r.name !== y.remotes[j].name || r.remote !== y.remotes[j].remote)
    ) {
      return false
    }
    if ((x.stash?.selector ?? null) !== (y.stash?.selector ?? null)) return false
  }
  return true
}

/**
 * 决定刷新落地用哪个 commits 引用：结构未变 → 复用旧数组（React 层零重渲染）；
 * 仅未提交行的计数/时间变了 → 只换第 0 条、其余行引用不变；否则整体替换。
 */
function reconcileCommits(prev: GitCommit[], next: GitCommit[]): GitCommit[] {
  if (!sameCommits(prev, next)) return next
  if (
    prev.length > 0 &&
    prev[0].hash === UNCOMMITTED &&
    (prev[0].message !== next[0].message || prev[0].date !== next[0].date)
  ) {
    return [next[0], ...prev.slice(1)]
  }
  return prev
}

/** 右键菜单目标在新提交列表中是否仍存在（消失即关，menus-dialogs §7.2）。 */
function menuTargetAlive(
  target: GitMenuTarget,
  commits: GitCommit[],
  has: (hash: string) => boolean
): boolean {
  switch (target.kind) {
    case 'commit':
    case 'branch':
    case 'remote-branch':
    case 'tag':
    case 'stash':
      return has(target.hash)
    case 'uncommitted':
    case 'uncommitted-file': // 提交面板文件行菜单：与未提交行同一存活条件（面板本身随行消失而关）
    case 'uncommitted-files': // 提交面板批量菜单：同未提交行存活条件
      return commits.length > 0 && commits[0].hash === UNCOMMITTED
    case 'file':
      // fromHash 可能是未加载窗口之外的父提交，只校验 toHash（菜单从属的详情面板同样按它收敛）
      return has(target.toHash)
    case 'header':
      return true
  }
}

/** 对话框目标（提交 hash / stash selector）是否仍存在；纯分支名类对话框不在此收敛。 */
function dialogTargetAlive(
  dialog: GitDialogRequest,
  commits: GitCommit[],
  has: (hash: string) => boolean,
  opInProgress: GitOpInProgress | null
): boolean {
  // 中止确认无 hash/selector，以操作状态收敛：用户已在终端自行收口（操作变化/消失）
  // 时关框，防止对着已结束的操作点「中止」吃 git 报错
  if (dialog.kind === 'op-abort') return dialog.op === opInProgress
  if ('hash' in dialog && !has(dialog.hash)) return false
  if ('selector' in dialog && !commits.some((c) => c.stash?.selector === dialog.selector)) {
    return false
  }
  return true
}

/**
 * 刷新落地：refresh 打开中的详情 / 菜单 / 对话框 —— 目标提交在新列表中消失即关，
 * 防止对过期 hash 执行动作（menus-dialogs §7.2；watch-refresh §3.2）。
 * diff 从属于详情：详情关则一并关；详情存活时不按 hash 单独收敛
 * （diff 的 fromHash 可能是加载窗口之外的父提交，按存在性判断会误关正看着的 diff）。
 */
function reconcileOpenUi(
  cur: GitRepoState,
  commits: GitCommit[],
  opInProgress: GitOpInProgress | null
): Partial<GitRepoState> {
  const has = (hash: string): boolean => commits.some((c) => c.hash === hash)
  const out: Partial<GitRepoState> = {}
  // 提交面板（未提交普通详情）豁免收敛：目标是工作区本身、恒不过期——全部提交/丢弃后
  // 未提交行消失面板仍留着（空列表 + 可勾「修正」），工具栏无改动时也可直接打开它
  const isCommitPanel = cur.expanded?.hash === UNCOMMITTED && cur.expanded.compareWith === null
  if (
    cur.expanded &&
    !isCommitPanel &&
    !(
      has(cur.expanded.hash) &&
      (cur.expanded.compareWith === null || has(cur.expanded.compareWith))
    )
  ) {
    out.expanded = null
    out.diffView = null // diff 从属于详情，一并关闭
  }
  if (cur.contextMenu && !menuTargetAlive(cur.contextMenu.target, commits, has)) {
    out.contextMenu = null
  }
  if (cur.dialog && !dialogTargetAlive(cur.dialog, commits, has, opInProgress)) out.dialog = null
  return out
}

/** 按展开态构造详情请求；比较模式按行序归一化 from=较老一方（index 大 = 行序靠下 = 较老）。 */
function buildDetailsRequest(
  commits: GitCommit[],
  hash: string,
  stash: GitCommitStash | null,
  compareWith: string | null
): GitDetailsRequest {
  if (compareWith !== null) {
    const ia = commits.findIndex((c) => c.hash === hash)
    const ib = commits.findIndex((c) => c.hash === compareWith)
    return ia >= ib
      ? { kind: 'compare', fromHash: hash, toHash: compareWith }
      : { kind: 'compare', fromHash: compareWith, toHash: hash }
  }
  if (stash !== null) return { kind: 'stash', hash, stash }
  if (hash === UNCOMMITTED) return { kind: 'uncommitted' }
  const commit = commits.find((c) => c.hash === hash)
  return { kind: 'commit', hash, hasParents: (commit?.parents.length ?? 0) > 0 }
}

/** 会影响提交/refs 读取结果的设置键：这些键变更后需要硬刷新重拉数据。 */
const DATA_SETTING_KEYS: (keyof GitRepoSettings)[] = [
  'showRemoteBranches',
  'showStashes',
  'showTags',
  'includeCommitsMentionedByReflogs',
  'onlyFollowFirstParent',
  'commitOrdering',
  'hideRemotes'
]

// —— 模块级私有状态（非渲染数据，不入 store） ——

/** 每项目 loadRepos 代际号：晚到的旧清单静默丢弃。 */
const reposGen = new Map<string, number>()
/** 每仓库 load 代际号：新请求发出即 +1，落地时不匹配的旧响应静默丢弃（watch-refresh §7）。 */
const loadGen = new Map<string, number>()
/**
 * 每仓库 refetchExpanded 代际号（与 loadGen 同法）：未提交面板下多个并发重拉的目标
 * （hash/compareWith）恒相同，仅靠目标校验拦不住乱序落地——旧快照后到会覆盖新快照。
 */
const refetchGen = new Map<string, number>()
/** 每仓库 openDiff 代际号：连点/后台重拉时丢弃过期响应。 */
const diffGen = new Map<string, number>()
/** refresh 在途标记（防 ⌘R 连按并发多个 fetch --all，且防 fetching 被先完成者提前复位）。 */
const refreshing = new Set<string>()
/**
 * 每仓库的静默动作串行链（runQuietAction）：快速连点勾选时按 FIFO 逐个执行，
 * 防止并发 add / reset 争抢 index 锁产生竞态；链上的每一环自行兜错、恒 resolve。
 */
const quietChains = new Map<string, Promise<unknown>>()
/** loadMore 在途标记（防滚动自动加载重入）。 */
const loadingMore = new Set<string>()
/** 视图偏好只需拉一次（StrictMode 双挂载下也幂等）。 */
let viewPrefsFetched = false

export const useGit = create<GitStoreState>((set, get) => {
  /** 以默认空态为底合并 patch 写回某仓库的状态桶。 */
  const patchRepo = (repoPath: string, patch: Partial<GitRepoState>): void => {
    set((state) => ({
      repos: {
        ...state.repos,
        [repoPath]: { ...(state.repos[repoPath] ?? EMPTY_REPO), ...patch }
      }
    }))
  }

  /**
   * 后台重拉展开中的详情（不置 loading，不闪加载态）：软刷新后未提交侧的工作区内容
   * 可能已变而提交结构没变（watch-refresh §2.6）。响应落地前目标已切换、或已有更新的
   * 重拉在途（代际号不匹配）则丢弃——未提交面板下目标恒相同，仅靠目标校验拦不住乱序落地。
   */
  const refetchExpanded = async (repoPath: string): Promise<void> => {
    const exp = gitState(get(), repoPath).expanded
    if (!exp) return
    const { hash, stash, compareWith } = exp
    const gen = (refetchGen.get(repoPath) ?? 0) + 1
    refetchGen.set(repoPath, gen)
    const commits = gitState(get(), repoPath).commits
    const result = await window.api.gitDetails(
      repoPath,
      buildDetailsRequest(commits, hash, stash, compareWith)
    )
    if (refetchGen.get(repoPath) !== gen) return // 过期代际的响应：静默丢弃
    const cur = gitState(get(), repoPath).expanded
    if (!cur || cur.hash !== hash || cur.compareWith !== compareWith) return
    patchRepo(repoPath, {
      expanded: {
        ...cur,
        details: result.details,
        fileChanges: result.fileChanges,
        uncommitted: result.uncommitted,
        loading: false,
        error: result.error
      }
    })
    await syncDiffView(repoPath)
  }

  /**
   * 详情落地后对齐打开中的 diff：文件不在当前树里就关；活端点重拉（同身份保留旧正文防闪）。
   * 树还没落地时 reconcile 返回 keep，此处直接返回。
   */
  const syncDiffView = async (repoPath: string): Promise<void> => {
    const st = gitState(get(), repoPath)
    if (st.diffView === null) return
    const decision = reconcileDiffView(st.diffView, st.expanded)
    if (decision.action === 'close') {
      get().closeDiff(repoPath)
      return
    }
    if (decision.action === 'keep') return
    await get().openDiff(repoPath, decision.file, decision.fromHash, decision.toHash, {
      keepContent: true
    })
  }

  /**
   * 图谱级重载（切分支筛选 / 改视图开关）：保持 ready 布局（工具栏、分支下拉不闪没），
   * 只在图谱区盖 loading 遮罩。故意不走 load(hard)——那会清空提交并置全局 loading，
   * 连工具栏一起消失。先关引用旧提交的详情 / diff / 菜单 / 对话框，再软刷新原地换数据。
   * status 已是 ready 时 load 走软路径（不置 loading），旧图谱在遮罩下停留到新数据落地。
   */
  const graphReload = async (repoPath: string): Promise<void> => {
    patchRepo(repoPath, {
      graphLoading: true,
      expanded: null,
      diffView: null,
      contextMenu: null,
      dialog: null
    })
    try {
      await get().load(repoPath)
    } finally {
      patchRepo(repoPath, { graphLoading: false })
    }
  }

  return {
    repos: {},
    projectRepos: {},
    viewPrefs: DEFAULT_GIT_VIEW_PREFS,

    loadRepos: async (projectPath) => {
      const gen = (reposGen.get(projectPath) ?? 0) + 1
      reposGen.set(projectPath, gen)
      const known = get().projectRepos[projectPath]
      const [list, ui] = await Promise.all([
        window.api.gitRepos(projectPath),
        known === undefined ? window.api.gitGetUi(projectPath) : null
      ])
      if (reposGen.get(projectPath) !== gen) return
      const remembered = get().projectRepos[projectPath]?.selected ?? ui?.selectedRepo ?? null
      const selected = pickSelectedRepo(list, remembered)
      set((state) => ({
        projectRepos: { ...state.projectRepos, [projectPath]: { list, selected } }
      }))
      if (selected !== null && gitState(get(), selected).status === 'idle') {
        void get().load(selected)
      }
    },

    selectRepo: (projectPath, repoPath) => {
      const cur = get().projectRepos[projectPath]
      if (cur === undefined || cur.selected === repoPath) return
      set((state) => ({
        projectRepos: { ...state.projectRepos, [projectPath]: { ...cur, selected: repoPath } }
      }))
      void window.api.gitSetUi(projectPath, { selectedRepo: repoPath })
      if (gitState(get(), repoPath).status === 'idle') void get().load(repoPath)
    },

    load: async (repoPath, opts) => {
      const hard = opts?.hard ?? false
      const prev = gitState(get(), repoPath)
      const gen = (loadGen.get(repoPath) ?? 0) + 1
      loadGen.set(repoPath, gen)
      if (hard) {
        // 硬刷新：清提交、关详情/diff/菜单/对话框后进 loading（watch-refresh §2.8）
        patchRepo(repoPath, {
          status: 'loading',
          loadError: null,
          commits: [],
          expanded: null,
          diffView: null,
          contextMenu: null,
          dialog: null
        })
      } else if (prev.status === 'idle' || prev.status === 'error') {
        // 首次加载 / 错误后重来才进 loading；软刷新保持 ready，表格不动
        patchRepo(repoPath, { status: 'loading', loadError: null })
      }
      // 首次接触：并行补拉视图偏好与每仓库设置（权威快照直接落桶，重复调用无害）
      if (!viewPrefsFetched) {
        viewPrefsFetched = true
        void window.api.gitGetViewPrefs().then((p) => set({ viewPrefs: p }))
      }
      if (prev.settings === null) {
        void window.api.gitGetSettings(repoPath).then((s) => patchRepo(repoPath, { settings: s }))
      }
      const bucket = gitState(get(), repoPath)
      const result = await window.api.gitLoad(repoPath, {
        maxCommits: bucket.maxCommits,
        branches: bucket.branchFilter
      })
      if (loadGen.get(repoPath) !== gen) return // 过期代际的响应：已有更新的请求在途/落地
      if (result.error !== null) {
        patchRepo(repoPath, { status: 'error', loadError: result.error })
        return
      }
      const cur = gitState(get(), repoPath)
      const commits = reconcileCommits(cur.commits, result.commits)
      patchRepo(repoPath, {
        status: 'ready',
        isRepo: result.isRepo,
        isEmptyRepo: result.isEmptyRepo,
        commits,
        headHash: result.headHash,
        currentBranch: result.currentBranch,
        branches: result.branches,
        remoteBranches: result.remoteBranches,
        remotes: result.remotes,
        tags: result.tags,
        moreCommitsAvailable: result.moreCommitsAvailable,
        opInProgress: result.opInProgress,
        worktrees: result.worktrees,
        loadError: null,
        ...reconcileOpenUi(cur, commits, result.opInProgress)
      })
      // 展开详情含未提交侧时，工作区内容可能已变：刷新详情数据（不闪 loading）。此处 await
      // 而非 void——让暂存/提交等静默动作的软刷新在两段列表落地后才返回，调用方（提交面板的
      // 乐观勾选）据此可靠收口乐观态、不回弹；.catch 兜底防 refetch 意外 reject 污染 load。
      const after = gitState(get(), repoPath).expanded
      if (
        after &&
        !after.loading &&
        (after.hash === UNCOMMITTED || after.compareWith === UNCOMMITTED)
      ) {
        await refetchExpanded(repoPath).catch(() => {})
      } else {
        // 历史提交详情不会重拉，但「与工作区对比」仍是活端点，软刷新后要对齐
        await syncDiffView(repoPath).catch(() => {})
      }
      // config 已经拉过的仓库顺带后台保鲜（工具栏拉取按钮的 upstream 判断依赖它；
      // 上游关系可能被动作改写，如 push --set-upstream）
      if (gitState(get(), repoPath).config !== null) {
        void get().loadRepoConfig(repoPath)
      }
    },

    refresh: async (repoPath, opts) => {
      // 在途防重入（⌘R 连按 / 首段软刷新窗口内按钮尚未置灰）：避免并发多个 fetch --all
      // 争抢 ref 锁，也避免先完成的一轮把 fetching 提前复位
      if (refreshing.has(repoPath)) return
      refreshing.add(repoPath)
      try {
        // 1) 先软刷新：本地图谱原地更新，不置全局 loading（数据未变时表格零重渲染）。
        //    主动刷新不只信监听通知，先作废工作区快照，未提交计数与详情重新取（ADR-0056）
        await window.api.gitInvalidateWorkingTree(repoPath)
        await get().load(repoPath)
        // 2) 无远程可 fetch：软刷新即全部语义
        if (gitState(get(), repoPath).remotes.length === 0) return
        // 3) 静默 fetch：刻意不走 runAction —— 不置 actionRunning，不弹进行中遮罩，
        //    只以 fetching 驱动工具栏刷新钮转圈
        patchRepo(repoPath, { fetching: true })
        try {
          let result: GitActionResult
          try {
            result = await window.api.gitAction(repoPath, {
              kind: 'fetch',
              remote: null,
              prune: false,
              pruneTags: false
            })
          } catch {
            // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）
            result = { status: 'error', errors: ['IPC 调用失败'] }
          }
          // 4) 用户显式点了刷新：网络失败要可见，落 actionErrors 走统一错误框（自动获取除外）
          if (result.status === 'error' && opts?.suppressErrorBox !== true) {
            patchRepo(repoPath, { actionErrors: result.errors })
          }
        } finally {
          // 5) 收口后再软刷新一次，把 fetch 到的远程 ref 刷进图。主进程 gitAction handler
          //    也会推 git:changed 触发一次软刷新，与这里的显式 load 由代际号去重，无害。
          patchRepo(repoPath, { fetching: false })
          await get().load(repoPath)
        }
      } finally {
        refreshing.delete(repoPath)
      }
    },

    loadMore: async (repoPath) => {
      const st = gitState(get(), repoPath)
      if (st.status !== 'ready' || !st.moreCommitsAvailable) return
      if (loadingMore.has(repoPath)) return // 在途防重入（滚动自动加载会高频触发）
      loadingMore.add(repoPath)
      try {
        patchRepo(repoPath, { maxCommits: st.maxCommits + GIT_DEFAULTS.loadMoreCommits })
        await get().load(repoPath)
      } finally {
        loadingMore.delete(repoPath)
      }
    },

    setBranchFilter: async (repoPath, branches) => {
      // 改筛选：maxCommits 重置回初始窗口（watch-refresh §4），随后图谱级重载
      // （只给图谱区加 loading，工具栏与分支下拉不闪没）
      patchRepo(repoPath, {
        branchFilter: branches,
        maxCommits: GIT_DEFAULTS.initialLoadCommits
      })
      await graphReload(repoPath)
    },

    updateSettings: async (repoPath, patch) => {
      const snapshot = await window.api.gitSetSettings(repoPath, patch)
      patchRepo(repoPath, { settings: snapshot })
      // 当前设置键几乎全是数据可见性开关（远程/贮藏/标签/排序等），命中即重拉；
      // 与切分支同为「换显示参数」，走图谱级重载而非全局硬刷新
      if (DATA_SETTING_KEYS.some((k) => k in patch)) {
        await graphReload(repoPath)
      }
    },

    loadRepoConfig: async (repoPath) => {
      const result = await window.api.gitRepoConfig(repoPath)
      // 失败时置 null 即可（设置面板显示空态），不打断主视图
      patchRepo(repoPath, { config: result.config })
    },

    setViewPrefs: async (patch) => {
      set({ viewPrefs: await window.api.gitSetViewPrefs(patch) })
    },

    openDetails: async (repoPath, hash, stash) => {
      patchRepo(repoPath, {
        expanded: {
          hash,
          stash,
          compareWith: null,
          details: null,
          fileChanges: null,
          uncommitted: null,
          loading: true,
          error: null
        },
        diffView: null // 换目标即关旧 diff
      })
      const commits = gitState(get(), repoPath).commits
      const result = await window.api.gitDetails(
        repoPath,
        buildDetailsRequest(commits, hash, stash, null)
      )
      const cur = gitState(get(), repoPath).expanded
      if (!cur || cur.hash !== hash || cur.compareWith !== null) return // 已切换/关闭，丢弃
      patchRepo(repoPath, {
        expanded: {
          ...cur,
          details: result.details,
          fileChanges: result.fileChanges,
          uncommitted: result.uncommitted,
          loading: false,
          error: result.error
        }
      })
    },

    openCompare: async (repoPath, hashA, hashB) => {
      const commits = gitState(get(), repoPath).commits
      const stash = commits.find((c) => c.hash === hashA)?.stash ?? null
      patchRepo(repoPath, {
        expanded: {
          hash: hashA,
          stash,
          compareWith: hashB,
          details: null,
          fileChanges: null,
          uncommitted: null,
          loading: true,
          error: null
        },
        diffView: null
      })
      const result = await window.api.gitDetails(
        repoPath,
        buildDetailsRequest(commits, hashA, stash, hashB)
      )
      const cur = gitState(get(), repoPath).expanded
      if (!cur || cur.hash !== hashA || cur.compareWith !== hashB) return
      patchRepo(repoPath, {
        expanded: {
          ...cur,
          details: null, // 比较模式没有单提交元信息
          fileChanges: result.fileChanges,
          loading: false,
          error: result.error
        }
      })
    },

    closeDetails: (repoPath) => {
      patchRepo(repoPath, { expanded: null, diffView: null })
    },

    openDiff: async (repoPath, file, fromHash, toHash, opts) => {
      const prev = gitState(get(), repoPath).diffView
      // 后台对齐：面板已关或已换成别的文件时不要把旧 diff 抢回来
      if (
        opts?.keepContent === true &&
        (prev === null || prev.file.newFilePath !== file.newFilePath)
      ) {
        return
      }
      const keep =
        opts?.keepContent === true &&
        prev !== null &&
        prev.fromHash === fromHash &&
        prev.toHash === toHash
      const gen = (diffGen.get(repoPath) ?? 0) + 1
      diffGen.set(repoPath, gen)
      patchRepo(repoPath, {
        diffView: {
          file,
          fromHash,
          toHash,
          data: keep ? prev.data : null,
          loading: true,
          error: keep ? prev.error : null
        }
      })
      const result = await window.api.gitFileDiff(repoPath, {
        fromHash,
        toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      })
      if (diffGen.get(repoPath) !== gen) return
      const cur = gitState(get(), repoPath).diffView
      if (
        !cur ||
        cur.file.newFilePath !== file.newFilePath ||
        cur.fromHash !== fromHash ||
        cur.toHash !== toHash
      ) {
        return // 已切换到别的文件/关闭，丢弃过期响应
      }
      patchRepo(repoPath, {
        diffView: { ...cur, file, data: result.diff, loading: false, error: result.error }
      })
    },

    closeDiff: (repoPath) => {
      diffGen.set(repoPath, (diffGen.get(repoPath) ?? 0) + 1)
      patchRepo(repoPath, { diffView: null })
    },

    openContextMenu: (repoPath, menu) => {
      patchRepo(repoPath, { contextMenu: menu })
    },

    closeContextMenu: (repoPath) => {
      patchRepo(repoPath, { contextMenu: null })
    },

    openDialog: (repoPath, req) => {
      // 弹对话框前先关菜单（全局互斥，menus-dialogs §7.3）
      patchRepo(repoPath, { dialog: req, contextMenu: null })
    },

    closeDialog: (repoPath) => {
      patchRepo(repoPath, { dialog: null })
    },

    pullCurrentBranch: (repoPath, mode) => {
      const st = gitState(get(), repoPath)
      if (st.currentBranch === null) return
      const direct = prefersDirect(st.settings?.pullSkipDialog ?? false, mode)
        ? directPullAction(st)
        : null
      if (direct !== null) {
        void get().runAction(repoPath, direct, '正在拉取分支')
      } else {
        get().openDialog(repoPath, { kind: 'pull-branch', preset: null, offerSkip: true })
      }
    },

    pushCurrentBranch: (repoPath, mode) => {
      const st = gitState(get(), repoPath)
      if (st.currentBranch === null) return
      const direct = prefersDirect(st.settings?.pushSkipDialog ?? false, mode)
        ? directPushAction(st)
        : null
      if (direct !== null) {
        void get().runAction(repoPath, direct, '正在推送分支')
      } else {
        get().openDialog(repoPath, {
          kind: 'push-branch',
          branch: st.currentBranch,
          offerSkip: true
        })
      }
    },

    setFind: (repoPath, patch) => {
      if (patch === null) {
        patchRepo(repoPath, { find: null })
        return
      }
      const st = gitState(get(), repoPath)
      const prefs = get().viewPrefs
      // 首次打开时用视图偏好里的查找选项做初值
      const base: GitFindState = st.find ?? {
        open: false,
        query: '',
        caseSensitive: prefs.findIsCaseSensitive,
        regex: prefs.findIsRegex,
        matches: [],
        activeIdx: -1,
        focusSeq: 0
      }
      patchRepo(repoPath, { find: { ...base, ...patch } })
    },

    openFind: (repoPath, selection = '') => {
      const find = gitState(get(), repoPath).find
      const seed = findSeed(selection, find?.regex ?? get().viewPrefs.findIsRegex)
      get().setFind(repoPath, {
        open: true,
        focusSeq: (find?.focusSeq ?? 0) + 1,
        ...(seed !== null && { query: seed })
      })
    },

    clearActionErrors: (repoPath) => {
      patchRepo(repoPath, { actionErrors: null })
    },

    runAction: async (repoPath, action, label) => {
      // 联网动作是 Task（docs/prd/task-progress.md）：进度弹窗与失败的错误框由任务登记处呈现，
      // 不走进行中遮罩与 actionErrors
      const isTask = gitTaskTitle(action) !== null
      patchRepo(
        repoPath,
        isTask ? { actionErrors: null } : { actionRunning: label, actionErrors: null }
      )
      const settle: Partial<GitRepoState> = isTask ? {} : { actionRunning: null }
      let result: GitActionResult
      let fromRegistry = isTask
      try {
        result = await window.api.gitAction(repoPath, action)
      } catch {
        // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）：登记处里没有它，照常报错
        result = { status: 'error', errors: ['IPC 调用失败'] }
        fromRegistry = false
      }
      // 在项目根初始化（repoPath 即项目路径）：选中新建的这个仓库
      if (result.status === 'ok' && action.kind === 'init') get().selectRepo(repoPath, repoPath)
      if (result.status === 'ok') {
        // 成功：先软刷新把动作结果拉回来，刷新落地后再收口进行中遮罩（finaliseLoadCommits 语义）
        try {
          await get().load(repoPath)
        } finally {
          patchRepo(repoPath, settle)
        }
      } else if (result.status === 'error' && !fromRegistry) {
        patchRepo(repoPath, { ...settle, actionErrors: result.errors })
      } else {
        // Task 失败（留在登记处）/ 取消；push-tag-not-on-remote：原样返回，由推送标签对话框续弹确认（不算错误）
        patchRepo(repoPath, settle)
      }
      return result
    },

    runQuietAction: async (repoPath, action, opts) => {
      // 静默即时（PRD 12c）：不置 actionRunning（无进行中遮罩），挂到该仓库的 FIFO 串行链上
      const prev = quietChains.get(repoPath) ?? Promise.resolve()
      const run = prev.then(async (): Promise<GitActionResult> => {
        let result: GitActionResult
        try {
          // silent：静默动作自己在下方 await load 软刷新，让主进程别再推 git:changed，
          // 否则 onGitChanged 会发起并发 load 与这次 load 抢代际号，使乐观勾选偶发闪现
          result = await window.api.gitAction(repoPath, action, { silent: true })
        } catch {
          // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）
          result = { status: 'error', errors: ['IPC 调用失败'] }
        }
        if (result.status === 'ok') {
          // 成功：软刷新原地换数据（load 内部会对展开中的未提交详情做后台重拉）。
          // load 约定不 reject（错误折叠进返回值），此处兜底防御：一旦意外 reject，
          // rejected 的环会被存回 quietChains，后续所有静默动作被永久跳过（链毒化）
          try {
            await get().load(repoPath)
          } catch {
            // 兜底吞掉：保证链上的每一环恒 resolve
          }
        } else if (result.status === 'error' && opts?.suppressErrorBox !== true) {
          patchRepo(repoPath, { actionErrors: result.errors })
        }
        return result
      })
      quietChains.set(repoPath, run)
      return run
    },

    setCommitDraft: (repoPath, patch) => {
      const cur = gitState(get(), repoPath).commitDraft
      patchRepo(repoPath, { commitDraft: { ...cur, ...patch } })
    }
  }
})
