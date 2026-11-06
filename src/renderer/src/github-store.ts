// GitHub 账号、提交检查与仓库列表的渲染端 store（docs/prd/github-checks.md、docs/prd/git-remote-github.md）：账号
// （首帧取自 bootstrap，随主进程推送更新）、每仓库的检查汇总，以及仓库选择用的仓库列表。何时去查检查由 Git Tab 的
// useCommitChecks 决定；这里每仓库同一时刻只跑一个查询，期间新要查的提交并入下一轮，免得先发后到的旧响应盖掉新结果。
// 仓库列表按仓库选择的需要重读，读到之前照旧显示上次的。换账号或退出即清空检查汇总与仓库列表（权限可能不同）。

import { create } from 'zustand'
import type { CommitCheckState, GitHubAccount, GitHubRepo, GitHubReposResult } from '@shared/github'

/** 仓库列表：读取中，或读到的结果。 */
export type GitHubReposState = { status: 'loading' } | GitHubReposResult

export interface GitHubStoreState {
  account: GitHubAccount | null
  /** 每仓库（GitRepo.path）：提交 hash → 检查汇总（没查过的不在表里） */
  checks: Record<string, Record<string, CommitCheckState>>
  /** 当前账号能访问的仓库（仓库选择用）；null 为还没读过 */
  repos: GitHubReposState | null
  setAccount(account: GitHubAccount | null): void
  /** 查这些提交的检查汇总并并入；未登录时不查 */
  queryChecks(repoPath: string, hashes: string[]): Promise<void>
  /**
   * 重读仓库列表（已在读时不重复发；给了 maxAge 则列表在这么多毫秒内读到过也不重读）；读到之前保留上次读到的，重读失败
   * 也不丢掉它
   */
  loadRepos(maxAge?: number): Promise<void>
  /** 新建的仓库放到列表最前（列表还没读到时不动，下次读会带上它） */
  addRepo(repo: GitHubRepo): void
}

/** 没查过任何提交的仓库的空表（稳定引用，供 selector 复用避免无谓重渲染）。 */
const NO_CHECKS: Record<string, CommitCheckState> = {}

/** 取某仓库的检查汇总表。 */
export function commitChecks(
  s: GitHubStoreState,
  repoPath: string
): Record<string, CommitCheckState> {
  return s.checks[repoPath] ?? NO_CHECKS
}

/** 首帧的账号：preload 快照同步带出。 */
function initialAccount(): GitHubAccount | null {
  try {
    return window.api.getBootstrap().githubAccount
  } catch {
    // vitest / 非 Electron 环境
    return null
  }
}

/** 查询进行中的仓库。 */
const running = new Set<string>()
/** 查询进行中又要查的提交（按仓库），等这一轮结束后一起查。 */
const queued = new Map<string, Set<string>>()
/** 仓库列表正在读。 */
let reposLoading = false
/** 仓库列表上次读到的时刻（ms）。 */
let reposLoadedAt = 0

export const useGitHub = create<GitHubStoreState>((set, get) => ({
  account: initialAccount(),
  checks: {},
  repos: null,

  setAccount: (account) => {
    if (account?.login === get().account?.login) return
    set({ account, checks: {}, repos: null })
  },

  queryChecks: async (repoPath, hashes) => {
    if (get().account === null || hashes.length === 0) return
    if (running.has(repoPath)) {
      const pending = queued.get(repoPath) ?? new Set<string>()
      for (const hash of hashes) pending.add(hash)
      queued.set(repoPath, pending)
      return
    }
    running.add(repoPath)
    try {
      let next = hashes
      while (next.length > 0) {
        const login = get().account?.login
        const states = await window.api.githubCommitChecks(repoPath, next)
        // 查询期间换了账号或退出：结果作废
        if (login !== undefined && get().account?.login === login) mergeChecks(repoPath, states)
        const more = queued.get(repoPath)
        queued.delete(repoPath)
        next = more === undefined ? [] : [...more]
      }
    } finally {
      running.delete(repoPath)
    }
  },

  loadRepos: async (maxAge) => {
    const login = get().account?.login
    if (login === undefined || reposLoading) return
    if (
      maxAge !== undefined &&
      get().repos?.status === 'ok' &&
      Date.now() - reposLoadedAt < maxAge
    ) {
      return
    }
    reposLoading = true
    if (get().repos?.status !== 'ok') set({ repos: { status: 'loading' } })
    try {
      const result = await window.api.githubRepos()
      // 读取期间换了账号或退出：结果作废
      if (get().account?.login !== login) return
      if (result.status === 'ok') reposLoadedAt = Date.now()
      if (result.status === 'ok' || get().repos?.status !== 'ok') set({ repos: result })
    } finally {
      reposLoading = false
    }
  },

  addRepo: (repo) => {
    const repos = get().repos
    if (repos?.status === 'ok') set({ repos: { status: 'ok', repos: [repo, ...repos.repos] } })
  }
}))

/** 把查到的结果并入某仓库的表；没有变化时不换引用。 */
function mergeChecks(repoPath: string, states: Record<string, CommitCheckState>): void {
  const prev = commitChecks(useGitHub.getState(), repoPath)
  if (Object.entries(states).every(([hash, state]) => prev[hash] === state)) return
  useGitHub.setState((s) => ({
    checks: { ...s.checks, [repoPath]: { ...prev, ...states } }
  }))
}

/** 任一窗口登录或退出，主进程推给全部窗口：同步进本窗口 store。 */
export function syncGitHubAccountAcrossWindows(): () => void {
  return window.api.onGitHubAccountChanged((account) => useGitHub.getState().setAccount(account))
}
