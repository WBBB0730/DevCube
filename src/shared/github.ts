// GitHub 账号、提交检查与仓库（docs/prd/github-checks.md、docs/prd/git-remote-github.md）—— main / preload / renderer
// 三端共享的类型与 IPC 契约。只认 github.com 上的仓库；登录走 OAuth 设备授权，凭证只留在主进程（ADR-0054）。
// 术语见 CONTEXT.md（Check）。

/** 已登录的 GitHub 账号（渲染端只拿得到登录名，凭证不出主进程）。 */
export interface GitHubAccount {
  login: string
}

/**
 * 一个提交的检查汇总（图谱行上的图标）。none：GitHub 上没有这个提交，或它没有任何检查。
 * 失败含出错（GitHub 的 ERROR），进行中含等待（EXPECTED）。
 */
export type CommitCheckState = 'success' | 'failure' | 'pending' | 'none'

/** 单项检查的结果；neutral 为跳过、取消、中性等不算成败的结论。 */
export type CheckRunState = 'success' | 'failure' | 'pending' | 'neutral'

/** 提交详情里列出的一项检查。 */
export interface CheckRun {
  /** Actions 的作业为「工作流 / 作业」，其余为检查或状态的名字 */
  name: string
  state: CheckRunState
  /** 在 GitHub（或检查服务方）查看详情的地址；没有为 null */
  url: string | null
  /** 耗时（秒）；没开始、没结束或无从得知为 null */
  durationSec: number | null
  /** 正在运行时的开始时间（Unix 秒），界面据此显示已运行时长；排队中、已结束或无从得知为 null */
  runningSince: number | null
}

/** 设备授权拿到的一次性代码：用户在 verificationUri 页面输入 userCode。 */
export interface GitHubLoginCode {
  userCode: string
  verificationUri: string
}

export type GitHubLoginResult =
  | { status: 'ok'; account: GitHubAccount }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

// —— 仓库（docs/prd/git-remote-github.md） ——

/** 从 GitHub 选仓库时填哪种地址（设置 → 账号，全局记住）。 */
export type GitHubRepoProtocol = 'https' | 'ssh'

export const GITHUB_REPO_PROTOCOLS: readonly GitHubRepoProtocol[] = ['https', 'ssh']

export const GITHUB_REPO_PROTOCOL_LABELS: Record<GitHubRepoProtocol, string> = {
  https: 'HTTPS',
  ssh: 'SSH'
}

/** 当前账号能访问的一个 GitHub 仓库（自己的、参与协作的、所在组织的）。 */
export interface GitHubRepo {
  /** owner/name */
  fullName: string
  /** https://github.com/owner/name.git */
  httpsUrl: string
  /** git@github.com:owner/name.git */
  sshUrl: string
}

/** 仓库按设置的地址形式取地址。 */
export function gitHubRepoUrl(repo: GitHubRepo, protocol: GitHubRepoProtocol): string {
  return protocol === 'ssh' ? repo.sshUrl : repo.httpsUrl
}

export type GitHubReposResult =
  { status: 'ok'; repos: GitHubRepo[] } | { status: 'error'; message: string }

/**
 * 新建仓库时可选的组织（当前账号能在其中新建仓库的，按 GitHub 给的顺序）。orgScopeMissing：凭证是申请 read:org 之前
 * 登录拿到的，列不出组织，重新登录即可。
 */
export type GitHubOrgsResult =
  { status: 'ok'; orgs: string[]; orgScopeMissing: boolean } | { status: 'error'; message: string }

/** 新建一个空仓库（不带 README 等初始文件）。 */
export interface GitHubCreateRepoInput {
  /** 建在哪个组织下；null 为当前账号 */
  org: string | null
  name: string
  /** 空串为不写描述 */
  description: string
  isPrivate: boolean
}

export type GitHubCreateRepoResult =
  { status: 'ok'; repo: GitHubRepo } | { status: 'error'; message: string }

/** GitHub 仓库名的上限长度。 */
const GITHUB_REPO_NAME_MAX = 100

/** 仓库名不合法的原因；合法为 null。GitHub 只收 ASCII 字母、数字与 `.` `-` `_`，且不能是 `.` / `..`。 */
export function gitHubRepoNameError(name: string): string | null {
  if (name === '') return '请输入仓库名'
  if (name.length > GITHUB_REPO_NAME_MAX) return `仓库名不能超过 ${GITHUB_REPO_NAME_MAX} 个字符`
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return '仓库名只能包含字母、数字与 . - _'
  if (name === '.' || name === '..') return '仓库名不能是 . 或 ..'
  return null
}

/** 由目录名派生默认仓库名：GitHub 不收的字符换成 `-`、连续的并成一个（同 GitHub 网页的处理）。 */
export function defaultGitHubRepoName(dirName: string): string {
  return dirName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, GITHUB_REPO_NAME_MAX)
}

/** preload 暴露的 GitHub API（并入 RunAPI）。 */
export interface GitHubAPI {
  /** 当前登录的账号；未登录为 null */
  githubAccount(): Promise<GitHubAccount | null>
  /** 账号变了（登录、退出、凭证失效被清掉）：推给全部窗口 */
  onGitHubAccountChanged(cb: (account: GitHubAccount | null) => void): () => void
  /**
   * 设备授权登录：拿到代码即经 onGitHubLoginCode 推给发起的窗口（主进程同时把代码复制到剪贴板；验证页由用户
   * 点开，GitHub 不支持带代码预填），等用户在网页上授权完才返回。同一时刻只有一次，再发起会取消上一次
   */
  githubLogin(): Promise<GitHubLoginResult>
  onGitHubLoginCode(cb: (code: GitHubLoginCode) => void): () => void
  /** 取消进行中的登录（githubLogin 随后以 cancelled 收口） */
  githubLoginCancel(): Promise<void>
  githubLogout(): Promise<void>
  /** 仓库（GitRepo.path）有没有指向 github.com 的远程（查检查结果用的同一套认法；Git Tab 据此显示登录入口） */
  githubHasRepo(repoPath: string): Promise<boolean>
  /** 当前账号有没有给 DevCube 的仓库加星标；未登录或查不到为 null */
  githubStarred(): Promise<boolean | null>
  /** 给 DevCube 的仓库加星标（只在用户点按钮时调用；不提供取消），返回之后的状态；失败为 null */
  githubStar(): Promise<boolean | null>
  /**
   * 一批提交的检查汇总。仓库没有指向 GitHub 的远程、未登录或查询失败时返回空表；
   * 查到的提交才在表里（GitHub 上没有的为 none）
   */
  githubCommitChecks(repoPath: string, hashes: string[]): Promise<Record<string, CommitCheckState>>
  /** 一个提交的各项检查；查不到（同上）为 null */
  githubCheckRuns(repoPath: string, hash: string): Promise<CheckRun[] | null>
  /** 当前账号能访问的全部仓库，最近推送的在前；未登录或读不到为 error */
  githubRepos(): Promise<GitHubReposResult>
  /** 新建仓库时可选的组织；未登录或读不到为 error */
  githubOrgs(): Promise<GitHubOrgsResult>
  /** 在当前账号或组织下新建仓库 */
  githubCreateRepo(input: GitHubCreateRepoInput): Promise<GitHubCreateRepoResult>
}
