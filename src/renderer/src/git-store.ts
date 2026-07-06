// Git 图谱的渲染端 store：每项目一桶状态（提交/refs + 打开中的详情、diff、菜单、对话框）+ 跨项目视图偏好。
// GitProjectState / GitStoreState 契约最初冻结于 foundation.md §D（E/F/G 组件按此消费），
// 之后随产品演进有序扩展（如 fetching / refresh：工具栏「刷新 = fetch + 软重载」）；
// 改字段与方法签名仍需同步全部消费方。
// 刷新语义照 watch-refresh 规格：软刷新保持 ready 原地换数据（数据未变时连 commits 数组引用都不换，
// 行组件 memo 即零重渲染）；硬刷新清空后进 loading；过期响应用代际号静默丢弃。

import { create } from 'zustand'
import {
  DEFAULT_GIT_VIEW_PREFS,
  GIT_DEFAULTS,
  UNCOMMITTED,
  type GitAction,
  type GitActionResult,
  type GitCommit,
  type GitCommitStash,
  type GitDetailsRequest,
  type GitFileChange,
  type GitRepoConfig,
  type GitRepoSettings,
  type GitViewPrefs
} from '@shared/git'
import type {
  GitContextMenuState,
  GitDialogRequest,
  GitDiffViewState,
  GitExpandedState,
  GitFindState,
  GitMenuTarget
} from '@renderer/components/git/git-view-types'

/** 单个项目的 Git 图谱状态桶（冻结契约，foundation.md §D）。 */
export interface GitProjectState {
  /** loading 仅硬刷新（清空后重拉）；软刷新保持 ready 原地换数据 */
  status: 'idle' | 'loading' | 'ready' | 'error'
  isRepo: boolean
  isEmptyRepo: boolean
  commits: GitCommit[]
  headHash: string | null
  currentBranch: string | null
  branches: string[]
  remotes: string[]
  tags: string[]
  moreCommitsAvailable: boolean
  loadError: string | null
  /** 本次加载的提交窗口上限；初始 GIT_DEFAULTS.initialLoadCommits，「加载更多」+100 */
  maxCommits: number
  /** 分支筛选：null = 显示全部 */
  branchFilter: string[] | null
  /** 每项目持久化设置（首次 load 时拉取；null = 尚未取到） */
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

/** Git store 全量形状（冻结契约）。方法均以 projectPath 为第一参定位状态桶。 */
export interface GitStoreState {
  projects: Record<string, GitProjectState>
  viewPrefs: GitViewPrefs
  /** 加载/刷新某项目：默认软刷新（ready 原地换数据）；hard=true 清空后 loading 重拉 */
  load(projectPath: string, opts?: { hard?: boolean }): Promise<void>
  /** 显式刷新（工具栏刷新钮 / ⌘R）：先软刷新本地图谱，再静默 fetch 全部远程并把远程 ref 软刷进图 */
  refresh(projectPath: string): Promise<void>
  /** 「加载更多」：maxCommits += loadMoreCommits 后软刷新；有在途请求时幂等跳过 */
  loadMore(projectPath: string): Promise<void>
  /** 切换分支筛选：重置 maxCommits 并硬刷新 */
  setBranchFilter(projectPath: string, branches: string[] | null): Promise<void>
  /** 写每项目设置（返回权威快照落桶）；数据可见性开关变化时硬刷新 */
  updateSettings(projectPath: string, patch: Partial<GitRepoSettings>): Promise<void>
  /** 拉取仓库 git 配置（设置面板打开时按需调用） */
  loadRepoConfig(projectPath: string): Promise<void>
  /** 写跨项目视图偏好（返回权威快照） */
  setViewPrefs(patch: Partial<GitViewPrefs>): Promise<void>
  /** 打开提交/未提交/stash 详情（普通模式）；数据异步回填到 expanded */
  openDetails(projectPath: string, hash: string, stash: GitCommitStash | null): Promise<void>
  /** 打开两提交比较；请求前按行序归一化 from=较老一方 */
  openCompare(projectPath: string, hashA: string, hashB: string): Promise<void>
  closeDetails(projectPath: string): void
  /** 打开单文件 diff（from/to 由调用方按「from=较老」传入） */
  openDiff(
    projectPath: string,
    file: GitFileChange,
    fromHash: string,
    toHash: string
  ): Promise<void>
  closeDiff(projectPath: string): void
  openContextMenu(projectPath: string, menu: GitContextMenuState): void
  closeContextMenu(projectPath: string): void
  openDialog(projectPath: string, req: GitDialogRequest): void
  closeDialog(projectPath: string): void
  /** 更新查找状态：patch 合并；传 null 整体关闭并清空 */
  setFind(projectPath: string, patch: Partial<GitFindState> | null): void
  clearActionErrors(projectPath: string): void
  /** 执行写动作：置 actionRunning=label → gitAction → ok 软刷新收口 / error 落 actionErrors / push-tag 预检原样返回 */
  runAction(projectPath: string, action: GitAction, label: string): Promise<GitActionResult>
  /**
   * 静默动作（暂存 / 取消暂存 / 撤销 / 提交专用，PRD「静默即时」）：不置 actionRunning
   * （无进行中遮罩），每项目 FIFO 串行执行；'ok' 软刷新原地换数据，'error' 落 actionErrors
   */
  runQuietAction(projectPath: string, action: GitAction): Promise<GitActionResult>
  /** 写提交面板草稿（浅合并写回） */
  setCommitDraft(projectPath: string, patch: Partial<GitProjectState['commitDraft']>): void
}

/** 未加载项目的默认空态（稳定引用，供 selector 复用避免无谓重渲染）。 */
const EMPTY_PROJECT: GitProjectState = {
  status: 'idle',
  isRepo: false,
  isEmptyRepo: false,
  commits: [],
  headHash: null,
  currentBranch: null,
  branches: [],
  remotes: [],
  tags: [],
  moreCommitsAvailable: false,
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

/** 取某项目的状态桶；从未加载过则返回稳定的默认空态。 */
export function gitState(s: GitStoreState, projectPath: string): GitProjectState {
  return s.projects[projectPath] ?? EMPTY_PROJECT
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
  has: (hash: string) => boolean
): boolean {
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
function reconcileOpenUi(cur: GitProjectState, commits: GitCommit[]): Partial<GitProjectState> {
  const has = (hash: string): boolean => commits.some((c) => c.hash === hash)
  const out: Partial<GitProjectState> = {}
  if (
    cur.expanded &&
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
  if (cur.dialog && !dialogTargetAlive(cur.dialog, commits, has)) out.dialog = null
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

/** 每项目 load 代际号：新请求发出即 +1，落地时不匹配的旧响应静默丢弃（watch-refresh §7）。 */
const loadGen = new Map<string, number>()
/**
 * 每项目 refetchExpanded 代际号（与 loadGen 同法）：未提交面板下多个并发重拉的目标
 * （hash/compareWith）恒相同，仅靠目标校验拦不住乱序落地——旧快照后到会覆盖新快照。
 */
const refetchGen = new Map<string, number>()
/** refresh 在途标记（防 ⌘R 连按并发多个 fetch --all，且防 fetching 被先完成者提前复位）。 */
const refreshing = new Set<string>()
/**
 * 每项目的静默动作串行链（runQuietAction）：快速连点勾选时按 FIFO 逐个执行，
 * 防止并发 add / reset 争抢 index 锁产生竞态；链上的每一环自行兜错、恒 resolve。
 */
const quietChains = new Map<string, Promise<unknown>>()
/** loadMore 在途标记（防滚动自动加载重入）。 */
const loadingMore = new Set<string>()
/** 视图偏好只需拉一次（StrictMode 双挂载下也幂等）。 */
let viewPrefsFetched = false

export const useGit = create<GitStoreState>((set, get) => {
  /** 以默认空态为底合并 patch 写回某项目的状态桶。 */
  const patchProject = (projectPath: string, patch: Partial<GitProjectState>): void => {
    set((state) => ({
      projects: {
        ...state.projects,
        [projectPath]: { ...(state.projects[projectPath] ?? EMPTY_PROJECT), ...patch }
      }
    }))
  }

  /**
   * 后台重拉展开中的详情（不置 loading，不闪加载态）：软刷新后未提交侧的工作区内容
   * 可能已变而提交结构没变（watch-refresh §2.6）。响应落地前目标已切换、或已有更新的
   * 重拉在途（代际号不匹配）则丢弃——未提交面板下目标恒相同，仅靠目标校验拦不住乱序落地。
   */
  const refetchExpanded = async (projectPath: string): Promise<void> => {
    const exp = gitState(get(), projectPath).expanded
    if (!exp) return
    const { hash, stash, compareWith } = exp
    const gen = (refetchGen.get(projectPath) ?? 0) + 1
    refetchGen.set(projectPath, gen)
    const commits = gitState(get(), projectPath).commits
    const result = await window.api.gitDetails(
      projectPath,
      buildDetailsRequest(commits, hash, stash, compareWith)
    )
    if (refetchGen.get(projectPath) !== gen) return // 过期代际的响应：静默丢弃
    const cur = gitState(get(), projectPath).expanded
    if (!cur || cur.hash !== hash || cur.compareWith !== compareWith) return
    patchProject(projectPath, {
      expanded: {
        ...cur,
        details: result.details,
        fileChanges: result.fileChanges,
        uncommitted: result.uncommitted,
        loading: false,
        error: result.error
      }
    })
  }

  /**
   * 图谱级重载（切分支筛选 / 改视图开关）：保持 ready 布局（工具栏、分支下拉不闪没），
   * 只在图谱区盖 loading 遮罩。故意不走 load(hard)——那会清空提交并置全局 loading，
   * 连工具栏一起消失。先关引用旧提交的详情 / diff / 菜单 / 对话框，再软刷新原地换数据。
   * status 已是 ready 时 load 走软路径（不置 loading），旧图谱在遮罩下停留到新数据落地。
   */
  const graphReload = async (projectPath: string): Promise<void> => {
    patchProject(projectPath, {
      graphLoading: true,
      expanded: null,
      diffView: null,
      contextMenu: null,
      dialog: null
    })
    try {
      await get().load(projectPath)
    } finally {
      patchProject(projectPath, { graphLoading: false })
    }
  }

  return {
    projects: {},
    viewPrefs: DEFAULT_GIT_VIEW_PREFS,

    load: async (projectPath, opts) => {
      const hard = opts?.hard ?? false
      const prev = gitState(get(), projectPath)
      const gen = (loadGen.get(projectPath) ?? 0) + 1
      loadGen.set(projectPath, gen)
      if (hard) {
        // 硬刷新：清提交、关详情/diff/菜单/对话框后进 loading（watch-refresh §2.8）
        patchProject(projectPath, {
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
        patchProject(projectPath, { status: 'loading', loadError: null })
      }
      // 首次接触：并行补拉视图偏好与每项目设置（权威快照直接落桶，重复调用无害）
      if (!viewPrefsFetched) {
        viewPrefsFetched = true
        void window.api.gitGetViewPrefs().then((p) => set({ viewPrefs: p }))
      }
      if (prev.settings === null) {
        void window.api
          .gitGetSettings(projectPath)
          .then((s) => patchProject(projectPath, { settings: s }))
      }
      const bucket = gitState(get(), projectPath)
      const result = await window.api.gitLoad(projectPath, {
        maxCommits: bucket.maxCommits,
        branches: bucket.branchFilter
      })
      if (loadGen.get(projectPath) !== gen) return // 过期代际的响应：已有更新的请求在途/落地
      if (result.error !== null) {
        patchProject(projectPath, { status: 'error', loadError: result.error })
        return
      }
      const cur = gitState(get(), projectPath)
      const commits = reconcileCommits(cur.commits, result.commits)
      patchProject(projectPath, {
        status: 'ready',
        isRepo: result.isRepo,
        isEmptyRepo: result.isEmptyRepo,
        commits,
        headHash: result.headHash,
        currentBranch: result.currentBranch,
        branches: result.branches,
        remotes: result.remotes,
        tags: result.tags,
        moreCommitsAvailable: result.moreCommitsAvailable,
        loadError: null,
        ...reconcileOpenUi(cur, commits)
      })
      // 展开详情含未提交侧时，工作区内容可能已变：刷新详情数据（不闪 loading）。此处 await
      // 而非 void——让暂存/提交等静默动作的软刷新在两段列表落地后才返回，调用方（提交面板的
      // 乐观勾选）据此可靠收口乐观态、不回弹；.catch 兜底防 refetch 意外 reject 污染 load。
      const after = gitState(get(), projectPath).expanded
      if (
        after &&
        !after.loading &&
        (after.hash === UNCOMMITTED || after.compareWith === UNCOMMITTED)
      ) {
        await refetchExpanded(projectPath).catch(() => {})
      }
      // config 已经拉过的项目顺带后台保鲜（工具栏拉取按钮的 upstream 判断依赖它；
      // 上游关系可能被动作改写，如 push --set-upstream）
      if (gitState(get(), projectPath).config !== null) {
        void get().loadRepoConfig(projectPath)
      }
    },

    refresh: async (projectPath) => {
      // 在途防重入（⌘R 连按 / 首段软刷新窗口内按钮尚未置灰）：避免并发多个 fetch --all
      // 争抢 ref 锁，也避免先完成的一轮把 fetching 提前复位
      if (refreshing.has(projectPath)) return
      refreshing.add(projectPath)
      try {
        // 1) 先软刷新：本地图谱原地更新，不置全局 loading（数据未变时表格零重渲染）
        await get().load(projectPath)
        // 2) 无远程可 fetch：软刷新即全部语义
        if (gitState(get(), projectPath).remotes.length === 0) return
        // 3) 静默 fetch：刻意不走 runAction —— 不置 actionRunning，不弹进行中遮罩，
        //    只以 fetching 驱动工具栏刷新钮转圈
        patchProject(projectPath, { fetching: true })
        try {
          let result: GitActionResult
          try {
            result = await window.api.gitAction(projectPath, {
              kind: 'fetch',
              remote: null,
              prune: false,
              pruneTags: false
            })
          } catch {
            // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）
            result = { status: 'error', errors: ['IPC 调用失败'] }
          }
          // 4) 用户显式点了刷新：网络失败要可见，落 actionErrors 走统一错误框
          if (result.status === 'error') {
            patchProject(projectPath, { actionErrors: result.errors })
          }
        } finally {
          // 5) 收口后再软刷新一次，把 fetch 到的远程 ref 刷进图。主进程 gitAction handler
          //    也会推 git:changed 触发一次软刷新，与这里的显式 load 由代际号去重，无害。
          patchProject(projectPath, { fetching: false })
          await get().load(projectPath)
        }
      } finally {
        refreshing.delete(projectPath)
      }
    },

    loadMore: async (projectPath) => {
      const st = gitState(get(), projectPath)
      if (st.status !== 'ready' || !st.moreCommitsAvailable) return
      if (loadingMore.has(projectPath)) return // 在途防重入（滚动自动加载会高频触发）
      loadingMore.add(projectPath)
      try {
        patchProject(projectPath, { maxCommits: st.maxCommits + GIT_DEFAULTS.loadMoreCommits })
        await get().load(projectPath)
      } finally {
        loadingMore.delete(projectPath)
      }
    },

    setBranchFilter: async (projectPath, branches) => {
      // 改筛选：maxCommits 重置回初始窗口（watch-refresh §4），随后图谱级重载
      // （只给图谱区加 loading，工具栏与分支下拉不闪没）
      patchProject(projectPath, {
        branchFilter: branches,
        maxCommits: GIT_DEFAULTS.initialLoadCommits
      })
      await graphReload(projectPath)
    },

    updateSettings: async (projectPath, patch) => {
      const snapshot = await window.api.gitSetSettings(projectPath, patch)
      patchProject(projectPath, { settings: snapshot })
      // 当前设置键几乎全是数据可见性开关（远程/贮藏/标签/排序等），命中即重拉；
      // 与切分支同为「换显示参数」，走图谱级重载而非全局硬刷新
      if (DATA_SETTING_KEYS.some((k) => k in patch)) {
        await graphReload(projectPath)
      }
    },

    loadRepoConfig: async (projectPath) => {
      const result = await window.api.gitRepoConfig(projectPath)
      // 失败时置 null 即可（设置面板显示空态），不打断主视图
      patchProject(projectPath, { config: result.config })
    },

    setViewPrefs: async (patch) => {
      set({ viewPrefs: await window.api.gitSetViewPrefs(patch) })
    },

    openDetails: async (projectPath, hash, stash) => {
      patchProject(projectPath, {
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
      const commits = gitState(get(), projectPath).commits
      const result = await window.api.gitDetails(
        projectPath,
        buildDetailsRequest(commits, hash, stash, null)
      )
      const cur = gitState(get(), projectPath).expanded
      if (!cur || cur.hash !== hash || cur.compareWith !== null) return // 已切换/关闭，丢弃
      patchProject(projectPath, {
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

    openCompare: async (projectPath, hashA, hashB) => {
      const commits = gitState(get(), projectPath).commits
      const stash = commits.find((c) => c.hash === hashA)?.stash ?? null
      patchProject(projectPath, {
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
        projectPath,
        buildDetailsRequest(commits, hashA, stash, hashB)
      )
      const cur = gitState(get(), projectPath).expanded
      if (!cur || cur.hash !== hashA || cur.compareWith !== hashB) return
      patchProject(projectPath, {
        expanded: {
          ...cur,
          details: null, // 比较模式没有单提交元信息
          fileChanges: result.fileChanges,
          loading: false,
          error: result.error
        }
      })
    },

    closeDetails: (projectPath) => {
      patchProject(projectPath, { expanded: null, diffView: null })
    },

    openDiff: async (projectPath, file, fromHash, toHash) => {
      patchProject(projectPath, {
        diffView: { file, fromHash, toHash, data: null, loading: true, error: null }
      })
      const result = await window.api.gitFileDiff(projectPath, {
        fromHash,
        toHash,
        oldFilePath: file.oldFilePath,
        newFilePath: file.newFilePath,
        type: file.type
      })
      const cur = gitState(get(), projectPath).diffView
      if (
        !cur ||
        cur.file.newFilePath !== file.newFilePath ||
        cur.fromHash !== fromHash ||
        cur.toHash !== toHash
      ) {
        return // 已切换到别的文件/关闭，丢弃过期响应
      }
      patchProject(projectPath, {
        diffView: { ...cur, data: result.diff, loading: false, error: result.error }
      })
    },

    closeDiff: (projectPath) => {
      patchProject(projectPath, { diffView: null })
    },

    openContextMenu: (projectPath, menu) => {
      patchProject(projectPath, { contextMenu: menu })
    },

    closeContextMenu: (projectPath) => {
      patchProject(projectPath, { contextMenu: null })
    },

    openDialog: (projectPath, req) => {
      // 弹对话框前先关菜单（全局互斥，menus-dialogs §7.3）
      patchProject(projectPath, { dialog: req, contextMenu: null })
    },

    closeDialog: (projectPath) => {
      patchProject(projectPath, { dialog: null })
    },

    setFind: (projectPath, patch) => {
      if (patch === null) {
        patchProject(projectPath, { find: null })
        return
      }
      const st = gitState(get(), projectPath)
      const prefs = get().viewPrefs
      // 首次打开时用视图偏好里的查找选项做初值
      const base: GitFindState = st.find ?? {
        open: false,
        query: '',
        caseSensitive: prefs.findIsCaseSensitive,
        regex: prefs.findIsRegex,
        matches: [],
        activeIdx: -1
      }
      patchProject(projectPath, { find: { ...base, ...patch } })
    },

    clearActionErrors: (projectPath) => {
      patchProject(projectPath, { actionErrors: null })
    },

    runAction: async (projectPath, action, label) => {
      patchProject(projectPath, { actionRunning: label, actionErrors: null })
      let result: GitActionResult
      try {
        result = await window.api.gitAction(projectPath, action)
      } catch {
        // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）
        result = { status: 'error', errors: ['IPC 调用失败'] }
      }
      if (result.status === 'ok') {
        // 成功：先软刷新把动作结果拉回来，刷新落地后再收口进行中遮罩（finaliseLoadCommits 语义）
        try {
          await get().load(projectPath)
        } finally {
          patchProject(projectPath, { actionRunning: null })
        }
      } else if (result.status === 'error') {
        patchProject(projectPath, { actionRunning: null, actionErrors: result.errors })
      } else {
        // push-tag-not-on-remote：原样返回，由推送标签对话框续弹确认（不算错误）
        patchProject(projectPath, { actionRunning: null })
      }
      return result
    },

    runQuietAction: async (projectPath, action) => {
      // 静默即时（PRD 12c）：不置 actionRunning（无进行中遮罩），挂到该项目的 FIFO 串行链上
      const prev = quietChains.get(projectPath) ?? Promise.resolve()
      const run = prev.then(async (): Promise<GitActionResult> => {
        let result: GitActionResult
        try {
          // silent：静默动作自己在下方 await load 软刷新，让主进程别再推 git:changed，
          // 否则 onGitChanged 会发起并发 load 与这次 load 抢代际号，使乐观勾选偶发闪现
          result = await window.api.gitAction(projectPath, action, { silent: true })
        } catch {
          // invoke 通道异常兜底（主进程 handler 约定不 reject，此处仅防御）
          result = { status: 'error', errors: ['IPC 调用失败'] }
        }
        if (result.status === 'ok') {
          // 成功：软刷新原地换数据（load 内部会对展开中的未提交详情做后台重拉）。
          // load 约定不 reject（错误折叠进返回值），此处兜底防御：一旦意外 reject，
          // rejected 的环会被存回 quietChains，后续所有静默动作被永久跳过（链毒化）
          try {
            await get().load(projectPath)
          } catch {
            // 兜底吞掉：保证链上的每一环恒 resolve
          }
        } else if (result.status === 'error') {
          patchProject(projectPath, { actionErrors: result.errors })
        }
        return result
      })
      quietChains.set(projectPath, run)
      return run
    },

    setCommitDraft: (projectPath, patch) => {
      const cur = gitState(get(), projectPath).commitDraft
      patchProject(projectPath, { commitDraft: { ...cur, ...patch } })
    }
  }
})
