// Git Tab 的 GitHub 提交检查（docs/prd/github-checks.md）：图谱检查汇总的查询时机，与提交详情里的各项检查。
// 只在登录后、Git Tab 显示着时查；图谱的轮询只在前台（Tab 显示且窗口激活）进行。两处轮询都分挡：有变化即从
// 5 秒一次重新开始，之后一直没变化就逐挡放慢到 30 秒（pollDelay）。挑哪些提交见 git-checks。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CheckRun } from '@shared/github'
import { gitState, useGit } from '@renderer/git-store'
import { commitChecks, useGitHub } from '@renderer/github-store'
import {
  checkRunsInProgress,
  checkRunsSignature,
  hashesToQuery,
  pollDelay,
  remoteTipsSignature,
  type CheckQueryMode
} from './git-checks'

/** 远程分支指向变化后，继续重查远程分支末端的时长。 */
const RECHECK_TIPS_MS = 60_000

function query(projectPath: string, mode: CheckQueryMode, recheckTips = false): void {
  const github = useGitHub.getState()
  const hashes = hashesToQuery(
    gitState(useGit.getState(), projectPath).commits,
    commitChecks(github, projectPath),
    mode,
    recheckTips
  )
  void github.queryChecks(projectPath, hashes)
}

/**
 * 分挡轮询：按距启动多久决定下一次间隔（pollDelay），到点执行 tick 后再排下一次；返回停止函数。
 * 调用方把「变化」放进 effect 依赖，有变化即重启，重新从最快一挡开始。
 */
function startTieredPolling(tick: () => void): () => void {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout>
  const schedule = (): void => {
    timer = setTimeout(
      () => {
        tick()
        schedule()
      },
      pollDelay(Date.now() - startedAt)
    )
  }
  schedule()
  return () => clearTimeout(timer)
}

/**
 * 图谱的检查汇总：变为可见、登录、列表变化时补查没查过的；「刷新」的获取完成后全部重查；
 * 前台期间分挡轮询进行中的，远程分支指向变化后 1 分钟内连同远程分支末端上还没有检查的一起查。
 * 回到前台、远程分支指向变化、查到的结果有变化，都让轮询回到最快一挡。
 */
export function useCommitChecks(projectPath: string, visible: boolean, foreground: boolean): void {
  const signedIn = useGitHub((s) => s.account !== null)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const fetching = useGit((s) => gitState(s, projectPath).fetching)
  const checks = useGitHub((s) => commitChecks(s, projectPath))
  const tips = useMemo(() => remoteTipsSignature(commits), [commits])

  useEffect(() => {
    if (signedIn && visible) query(projectPath, 'unknown')
  }, [projectPath, signedIn, visible, commits])

  const lastTips = useRef(tips)
  const recheckTipsUntil = useRef(0)
  useEffect(() => {
    if (lastTips.current === tips) return
    lastTips.current = tips
    recheckTipsUntil.current = Date.now() + RECHECK_TIPS_MS
  }, [tips])

  const wasFetching = useRef(fetching)
  useEffect(() => {
    const finished = wasFetching.current && !fetching
    wasFetching.current = fetching
    if (finished && signedIn && visible) query(projectPath, 'all')
  }, [projectPath, fetching, signedIn, visible])

  // 检查汇总表只在有变化时换引用（github-store 的 mergeChecks），与远程分支签名一起作为「变化」重启轮询
  useEffect(() => {
    if (!signedIn || !foreground) return
    return startTieredPolling(() =>
      query(projectPath, 'poll', Date.now() < recheckTipsUntil.current)
    )
  }, [projectPath, signedIn, foreground, tips, checks])
}

/** 拉一个提交的各项检查；只有最后发出的那次的响应会落地（首次加载与定时重查可能乱序回来）。 */
function fetchCheckRuns(
  projectPath: string,
  hash: string,
  latest: { current: number },
  apply: (loaded: { hash: string; runs: CheckRun[] | null }) => void
): void {
  const seq = ++latest.current
  void window.api.githubCheckRuns(projectPath, hash).then((runs) => {
    if (latest.current === seq) apply({ hash, runs })
  })
}

/**
 * 一个提交的各项检查（提交详情用）：打开、换提交、汇总变化时拉一次；列表里还有没结束的项（或汇总仍是进行中）时
 * 分挡重查，某项开始、结束、出现或消失即回到最快一挡，全部结束即停。没有检查、没查过或未登录为 null。
 */
export function useCheckRuns(projectPath: string, hash: string): CheckRun[] | null {
  const state = useGitHub((s) => commitChecks(s, projectPath)[hash])
  const [loaded, setLoaded] = useState<{ hash: string; runs: CheckRun[] | null } | null>(null)
  const latest = useRef(0)
  const hasChecks = state !== undefined && state !== 'none'
  const runs = hasChecks && loaded?.hash === hash ? loaded.runs : null
  const inProgress = hasChecks && checkRunsInProgress(state, runs)
  const signature = checkRunsSignature(runs)

  useEffect(() => {
    if (hasChecks) fetchCheckRuns(projectPath, hash, latest, setLoaded)
  }, [projectPath, hash, hasChecks, state])

  useEffect(() => {
    if (!inProgress) return
    return startTieredPolling(() => fetchCheckRuns(projectPath, hash, latest, setLoaded))
  }, [projectPath, hash, inProgress, signature])

  return runs
}
