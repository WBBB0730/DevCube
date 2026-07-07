// Git 图谱（Git Graph）—— main / preload / renderer 三端共享的域模型与 IPC 契约。
// 移植自 vscode-git-graph：数据由主进程直接跑 git CLI 产出，渲染端只消费结构化结果。
// 术语见 CONTEXT.md（Git Tab / Commit Graph / Ref / Commit Details / Diff 面板）。

/** 「未提交更改」虚拟提交的 hash 常量（与参考实现一致，真实 hash 不可能是它）。 */
export const UNCOMMITTED = '*'

/**
 * 「暂存区（index）」diff 端点哨兵。diff 端点共三类：提交 hash / UNCOMMITTED（'*'，工作区）/
 * GIT_INDEX（'::index'，暂存区）。两段口径：已暂存 = HEAD→'::index'，未暂存 = '::index'→'*'。
 */
export const GIT_INDEX = '::index'

// —— 提交与 refs ——

export interface GitCommitTag {
  name: string
  /** 是否注释标签（annotated）；轻量标签为 false */
  annotated: boolean
}

export interface GitCommitRemote {
  /** 形如 "origin/main" */
  name: string
  /** 所属 remote 名；找不到（remote 已被删除等）为 null，此时禁用 push/pull 类操作 */
  remote: string | null
}

export interface GitCommitStash {
  /** 形如 "refs/stash@{0}"；UI 展示时去掉前缀 "refs/" */
  selector: string
  /** 做 stash 时所在的提交 */
  baseHash: string
  /** 带未跟踪文件的 stash 的第三个父提交；无则 null */
  untrackedFilesHash: string | null
}

/** 图谱中的一个提交行（含合成的「未提交更改」行与 stash 伪提交行）。 */
export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  /** Unix 秒 */
  date: number
  message: string
  /** 指向此提交的本地分支名 */
  heads: string[]
  tags: GitCommitTag[]
  remotes: GitCommitRemote[]
  /** 非 null 表示这是一条 stash 伪提交行 */
  stash: GitCommitStash | null
}

// —— 加载 ——

export interface GitLoadOptions {
  /** 本次加载的提交窗口大小（初始 300，「加载更多」+100 后整表重拉） */
  maxCommits: number
  /** 分支筛选：null = 显示全部；元素为分支名（可含 remotes/ 前缀）或 --glob= 模式 */
  branches: string[] | null
}

/** 一次完整加载的结果：仓库概要 + 提交列表 + refs，主进程内部串联产出。 */
export interface GitLoadResult {
  /** 项目根目录是否在 git 仓库内（false 时其余字段皆为空值） */
  isRepo: boolean
  /** 是仓库但还没有任何提交 */
  isEmptyRepo: boolean
  /** 分支名列表（当前分支排第 0；远程分支带 remotes/ 前缀），供分支筛选下拉 */
  branches: string[]
  /** 当前分支名；detached HEAD 为 null */
  currentBranch: string | null
  /** remote 名列表 */
  remotes: string[]
  commits: GitCommit[]
  /** HEAD 指向的提交 hash（detached 也有值）；空仓库为 null */
  headHash: string | null
  /** 全部 tag 名（去重），供对话框重名校验 */
  tags: string[]
  moreCommitsAvailable: boolean
  error: string | null
}

// —— 提交详情与文件变更 ——

export type GitFileStatus = 'A' | 'M' | 'D' | 'R' | 'U'

export interface GitFileChange {
  /** R 时为旧路径；其余等于 newFilePath。路径相对仓库根、'/' 分隔 */
  oldFilePath: string
  newFilePath: string
  type: GitFileStatus
  /** null：无数据（U / 合成的 D）或二进制文件 */
  additions: number | null
  deletions: number | null
  /**
   * true：未跟踪的目录整体条目（嵌套 git 仓库 / git 折叠的未跟踪目录，git status 只报目录不列内部）。
   * 在文件树里作为一个可勾选叶子呈现（勾选 = git add 整个目录），但不可打开 diff。
   */
  isDir?: boolean
}

export interface GitCommitDetails {
  hash: string
  parents: string[]
  author: string
  authorEmail: string
  /** Unix 秒；未提交详情（hash='*'）时为 0 */
  authorDate: number
  committer: string
  committerEmail: string
  committerDate: number
  /** 完整提交信息（主题 + 正文，已去尾部空行） */
  body: string
  fileChanges: GitFileChange[]
}

export type GitDetailsRequest =
  | { kind: 'commit'; hash: string; hasParents: boolean }
  | { kind: 'uncommitted' }
  | { kind: 'stash'; hash: string; stash: GitCommitStash }
  /** 比较两提交：from 为较老一方；to 可为 UNCOMMITTED（'*'，与工作区比较） */
  | { kind: 'compare'; fromHash: string; toHash: string }

/**
 * 未提交更改的两段文件列表（提交面板数据源）：已暂存 = HEAD↔index 快照差异；
 * 未暂存 = index↔工作区 + 未跟踪。同一文件可同时出现在两段（暂存后又改）。
 */
export interface GitUncommittedDetails {
  staged: GitFileChange[]
  unstaged: GitFileChange[]
}

export interface GitDetailsResult {
  /**
   * compare 请求时为 null（比较没有单提交元信息）；'uncommitted' 请求现在也恒为 null
   * （提交面板不需要伪提交元信息，两段文件列表在 uncommitted 字段里）
   */
  details: GitCommitDetails | null
  /** compare 请求时的文件变更列表；其余请求（含 'uncommitted'）为 null（在 details.fileChanges 里） */
  fileChanges: GitFileChange[] | null
  /** 'uncommitted' 请求的两段文件列表；其余请求为 null */
  uncommitted: GitUncommittedDetails | null
  error: string | null
}

// —— 单文件 diff（内置 diff 面板的数据源：原始 unified diff 文本 + 二进制判定） ——

export interface GitDiffRequest {
  /** 比较基（较老一方）。提交自身变更场景：fromHash === toHash（根提交 / stash 第三父） */
  fromHash: string
  /** UNCOMMITTED（'*'）表示与工作区比较 */
  toHash: string
  oldFilePath: string
  newFilePath: string
  type: GitFileStatus
}

export interface DiffFileData {
  oldFilePath: string
  newFilePath: string
  type: GitFileStatus
  /** 二进制文件：git 输出 "Binary files … differ"、无 diff 正文，raw 恒为 '' */
  binary: boolean
  /** git 原始 unified diff 文本（含 header 与全部 hunk），透传给渲染层的 diff 组件 */
  raw: string
}

export interface GitDiffResult {
  diff: DiffFileData | null
  error: string | null
}

// —— 二进制图片预览（diff 面板对图片文件的新旧预览） ——

/** 浏览器可直接渲染的图片扩展名 → MIME（svg 为文本 diff、不在此列）。 */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

/** 路径若是可预览的图片文件则返回其 MIME，否则 null（判定供主进程与渲染端共用）。 */
export function imageMimeOf(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null
}

export interface GitImageResult {
  /** 旧 / 新两侧图片的 data URL；该侧不存在（新增无旧、删除无新）或读取失败为 null */
  oldDataUrl: string | null
  newDataUrl: string | null
  error: string | null
}

// —— 标签详情（annotated tag 的消息） ——

export interface GitTagDetails {
  /** tag 对象自身的 hash（不是指向的提交） */
  hash: string
  taggerName: string
  taggerEmail: string
  taggerDate: number
  message: string
  /** 是否 GPG 签名（v1 不做签名校验，仅展示有无） */
  signed: boolean
}

export interface GitTagDetailsResult {
  details: GitTagDetails | null
  error: string | null
}

// —— 仓库 git 配置（仓库设置面板用，内存态不落盘） ——

export interface GitRepoConfig {
  /** local 配置中的 branch.<name>.remote / .pushremote */
  branches: Record<string, { remote: string | null; pushRemote: string | null }>
  pushDefault: string | null
  remotes: { name: string; url: string | null; pushUrl: string | null }[]
  user: {
    name: { local: string | null; global: string | null }
    email: { local: string | null; global: string | null }
  }
}

export interface GitRepoConfigResult {
  config: GitRepoConfig | null
  error: string | null
}

// —— 每项目 git 设置（持久化于 electron-store）与视图偏好 ——

/** 三态开关：default 回退到应用级默认值（见 GIT_DEFAULTS） */
export type BooleanOverride = 'default' | 'enabled' | 'disabled'

export type GitCommitOrdering = 'date' | 'author-date' | 'topo'

export interface GitRepoSettings {
  showRemoteBranches: BooleanOverride
  showStashes: BooleanOverride
  showTags: BooleanOverride
  includeCommitsMentionedByReflogs: BooleanOverride
  onlyFollowFirstParent: BooleanOverride
  /** 'default' 回退 GIT_DEFAULTS.commitOrdering */
  commitOrdering: 'default' | GitCommitOrdering
  /** 隐藏的 remote 名列表（不拉其分支、不在图上标注） */
  hideRemotes: string[]
}

/** 跨项目的视图偏好（查找选项、「不再提示」标记等） */
export interface GitViewPrefs {
  findIsCaseSensitive: boolean
  findIsRegex: boolean
  findOpenCommitDetailsView: boolean
  /** 「检出提交」确认框勾选过「总是允许」后为 true，此后直接执行 */
  alwaysAcceptCheckoutCommit: boolean
  /** push tag「提交不在远程」警告勾选过「总是继续」后为 true，跳过预检 */
  pushTagSkipRemoteCheck: boolean
  /** diff 面板视图模式：false = 统一（unified），true = 左右对比（side-by-side）；跨会话记忆 */
  diffSplitView: boolean
}

/** BooleanOverride 为 'default' 时的应用级默认值与其它全局常量。 */
export const GIT_DEFAULTS = {
  showRemoteBranches: true,
  showStashes: true,
  showTags: true,
  includeCommitsMentionedByReflogs: false,
  onlyFollowFirstParent: false,
  commitOrdering: 'date' as GitCommitOrdering,
  initialLoadCommits: 300,
  loadMoreCommits: 100
} as const

export const DEFAULT_GIT_REPO_SETTINGS: GitRepoSettings = {
  showRemoteBranches: 'default',
  showStashes: 'default',
  showTags: 'default',
  includeCommitsMentionedByReflogs: 'default',
  onlyFollowFirstParent: 'default',
  commitOrdering: 'default',
  hideRemotes: []
}

export const DEFAULT_GIT_VIEW_PREFS: GitViewPrefs = {
  findIsCaseSensitive: false,
  findIsRegex: false,
  findOpenCommitDetailsView: false,
  alwaysAcceptCheckoutCommit: false,
  pushTagSkipRemoteCheck: false,
  diffSplitView: true
}

/** 解一个三态开关的有效值。 */
export function resolveOverride(value: BooleanOverride, def: boolean): boolean {
  return value === 'default' ? def : value === 'enabled'
}

/** 把每项目设置解析成读取层直接可用的有效值（主进程 gitLoad 前调用；纯函数可测）。 */
export function resolveRepoSettings(s: GitRepoSettings): GitEffectiveSettings {
  return {
    showRemoteBranches: resolveOverride(s.showRemoteBranches, GIT_DEFAULTS.showRemoteBranches),
    showStashes: resolveOverride(s.showStashes, GIT_DEFAULTS.showStashes),
    showTags: resolveOverride(s.showTags, GIT_DEFAULTS.showTags),
    includeCommitsMentionedByReflogs: resolveOverride(
      s.includeCommitsMentionedByReflogs,
      GIT_DEFAULTS.includeCommitsMentionedByReflogs
    ),
    onlyFollowFirstParent: resolveOverride(
      s.onlyFollowFirstParent,
      GIT_DEFAULTS.onlyFollowFirstParent
    ),
    commitOrdering: s.commitOrdering === 'default' ? GIT_DEFAULTS.commitOrdering : s.commitOrdering,
    hideRemotes: s.hideRemotes
  }
}

/** 读取层直接可用的有效设置（BooleanOverride 已解析）。 */
export interface GitEffectiveSettings {
  showRemoteBranches: boolean
  showStashes: boolean
  showTags: boolean
  includeCommitsMentionedByReflogs: boolean
  onlyFollowFirstParent: boolean
  commitOrdering: GitCommitOrdering
  hideRemotes: string[]
}

// —— 动作（写操作）：单通道判别联合 ——

export type GitResetMode = 'soft' | 'mixed' | 'hard'
export type GitPushMode = 'normal' | 'force' | 'force-with-lease'
/** merge 的对象类型；也用于生成 squash 提交消息 */
export type GitMergeOn = 'branch' | 'remote-tracking' | 'commit'
export type GitRebaseOn = 'branch' | 'commit'

/**
 * 所有改动仓库状态的动作。每个变体的字段与参考实现的 git 参数一一对应；
 * 交互式 rebase 不在此列（渲染端映射到 Terminal 里执行）。
 */
export type GitAction =
  // 分支
  | { kind: 'checkout-branch'; branch: string; remoteBranch: string | null }
  | { kind: 'create-branch'; hash: string; name: string; checkout: boolean; force: boolean }
  | { kind: 'delete-branch'; name: string; force: boolean; deleteOnRemotes: string[] }
  | { kind: 'delete-remote-branch'; branch: string; remote: string }
  | { kind: 'rename-branch'; oldName: string; newName: string }
  // merge / rebase
  | {
      kind: 'merge'
      obj: string
      on: GitMergeOn
      noFastForward: boolean
      squash: boolean
      noCommit: boolean
    }
  | { kind: 'rebase'; obj: string; on: GitRebaseOn; ignoreDate: boolean }
  | { kind: 'drop-commit'; hash: string }
  // 提交
  | { kind: 'checkout-commit'; hash: string }
  | {
      kind: 'cherrypick'
      hash: string
      parentIndex: number
      recordOrigin: boolean
      noCommit: boolean
    }
  | { kind: 'revert'; hash: string; parentIndex: number }
  | { kind: 'reset'; hash: string; mode: GitResetMode }
  | { kind: 'reset-file'; hash: string; filePath: string }
  | { kind: 'clean-untracked'; directories: boolean }
  // 暂存与提交（提交面板）
  | { kind: 'stage-paths'; paths: string[] } // 暂存；paths 为空数组 = 全部（git add -A）
  | { kind: 'unstage-paths'; paths: string[] } // 取消暂存；空数组 = 全部（git reset -q）
  | { kind: 'discard-file'; paths: string[] } // 撤销文件的未暂存更改（工作区恢复为 index）
  | { kind: 'delete-untracked-file'; paths: string[] } // 从磁盘删除未跟踪文件
  | { kind: 'commit'; message: string; amend: boolean }
  // 远程同步
  | { kind: 'fetch'; remote: string | null; prune: boolean; pruneTags: boolean }
  | {
      kind: 'push-branch'
      branch: string
      remotes: string[]
      setUpstream: boolean
      mode: GitPushMode
    }
  | {
      kind: 'fetch-into-local'
      remote: string
      remoteBranch: string
      localBranch: string
      force: boolean
    }
  | {
      kind: 'pull-branch'
      remote: string
      branch: string
      noFastForward: boolean
      squash: boolean
    }
  // 标签
  | {
      kind: 'add-tag'
      hash: string
      name: string
      type: 'annotated' | 'lightweight'
      message: string
      force: boolean
      /** 创建后立即推送到的 remote；null = 不推送 */
      pushToRemote: string | null
      /** 推送阶段是否跳过「提交不在远程」预检（透传用户已保存的「总是继续」偏好） */
      skipRemoteCheck: boolean
    }
  | { kind: 'delete-tag'; name: string; deleteOnRemote: string | null }
  | {
      kind: 'push-tag'
      name: string
      remotes: string[]
      commitHash: string
      skipRemoteCheck: boolean
    }
  // 贮藏
  | { kind: 'stash-push'; message: string; includeUntracked: boolean }
  | { kind: 'stash-apply'; selector: string; reinstateIndex: boolean }
  | { kind: 'stash-pop'; selector: string; reinstateIndex: boolean }
  | { kind: 'stash-drop'; selector: string }
  | { kind: 'stash-branch'; selector: string; branchName: string }
  // remote 管理（仓库设置面板）
  | { kind: 'add-remote'; name: string; url: string; pushUrl: string | null; fetchAfter: boolean }
  | { kind: 'delete-remote'; name: string }
  | {
      kind: 'edit-remote'
      nameOld: string
      nameNew: string
      urlOld: string | null
      urlNew: string | null
      pushUrlOld: string | null
      pushUrlNew: string | null
    }
  | { kind: 'prune-remote'; name: string }
  // git 配置（用户信息编辑）
  | {
      kind: 'set-config'
      key: 'user.name' | 'user.email'
      value: string
      location: 'local' | 'global'
    }
  | { kind: 'unset-config'; key: 'user.name' | 'user.email'; location: 'local' | 'global' }

/**
 * 动作结果。push-tag 的「提交不在远程」预检失败以结构化状态返回
 * （参考实现用字符串前缀传递，移植改为判别联合），由渲染端弹确认框后带
 * skipRemoteCheck 重发。
 */
export type GitActionResult =
  | { status: 'ok' }
  | { status: 'error'; errors: string[] }
  | { status: 'push-tag-not-on-remote'; remotes: string[] }

// —— preload 暴露的 Git API（并入 RunAPI） ——

export interface GitAPI {
  /** 加载某项目的完整图谱数据（仓库概要 + 提交 + refs，主进程内部串联） */
  gitLoad(projectPath: string, options: GitLoadOptions): Promise<GitLoadResult>
  /** 提交 / 未提交 / stash 详情，或两提交比较的文件变更列表 */
  gitDetails(projectPath: string, request: GitDetailsRequest): Promise<GitDetailsResult>
  /** 单文件 diff（原始 unified diff 文本 + 二进制判定，内置 diff 面板数据源） */
  gitFileDiff(projectPath: string, request: GitDiffRequest): Promise<GitDiffResult>
  /** 二进制图片文件的新旧内容（diff 面板预览）；端点语义同 gitFileDiff */
  gitFileImage(projectPath: string, request: GitDiffRequest): Promise<GitImageResult>
  /** annotated tag 的详情（tagger / 消息） */
  gitTagDetails(projectPath: string, tagName: string): Promise<GitTagDetailsResult>
  /** 仓库 git 配置（remotes / user / pushDefault），仓库设置面板用 */
  gitRepoConfig(projectPath: string): Promise<GitRepoConfigResult>
  /**
   * 执行一个写动作；默认完成后主进程推 git:changed 触发刷新。
   * opts.silent=true 时不推 git:changed——供渲染端自刷新的静默动作（暂存/提交/撤销）用，
   * 避免与调用方自己的软刷新构成并发 load 竞态（提交面板乐观勾选闪现的根因）。
   */
  gitAction(
    projectPath: string,
    action: GitAction,
    opts?: { silent?: boolean }
  ): Promise<GitActionResult>
  /** 读 / 写每项目 git 设置（写返回更新后的权威快照） */
  gitGetSettings(projectPath: string): Promise<GitRepoSettings>
  gitSetSettings(projectPath: string, patch: Partial<GitRepoSettings>): Promise<GitRepoSettings>
  /** 读 / 写跨项目视图偏好 */
  gitGetViewPrefs(): Promise<GitViewPrefs>
  gitSetViewPrefs(patch: Partial<GitViewPrefs>): Promise<GitViewPrefs>
  /** 仓库内容变化（.git 变动 / 动作完成）：渲染端应重新 gitLoad 该项目 */
  onGitChanged(cb: (projectPath: string) => void): () => void
}
