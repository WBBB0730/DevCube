// 提交检查的查询时机（docs/prd/github-checks.md）：从图谱提交与已有检查汇总里挑出这一次要去 GitHub 查的提交，
// 提交详情的各项检查是否还要定时重查，以及分挡轮询的间隔。纯函数，由 use-github-checks 调用。

import { UNCOMMITTED, type GitCommit } from '@shared/git'
import type { CheckRun, CommitCheckState } from '@shared/github'

/**
 * 这一次查哪些：
 * - unknown：还没查过的（列表变化、变为可见、登录时）
 * - all：全部（刷新完成时；重新运行会让有结论的提交回到进行中）
 * - poll：进行中的（前台轮询）；recheckTips 时再加上远程分支末端上还没有检查的（推送后 GitHub 要几秒才建出检查）
 */
export type CheckQueryMode = 'unknown' | 'all' | 'poll'

/** 能去 GitHub 查的提交：去掉未提交行与贮藏（贮藏只在本地）。 */
function checkable(commits: readonly GitCommit[]): GitCommit[] {
  return commits.filter((c) => c.hash !== UNCOMMITTED && c.stash === null)
}

export function hashesToQuery(
  commits: readonly GitCommit[],
  states: Readonly<Record<string, CommitCheckState>>,
  mode: CheckQueryMode,
  recheckTips = false
): string[] {
  const candidates = checkable(commits)
  switch (mode) {
    case 'unknown':
      return candidates.filter((c) => states[c.hash] === undefined).map((c) => c.hash)
    case 'all':
      return candidates.map((c) => c.hash)
    case 'poll':
      return candidates
        .filter(
          (c) =>
            states[c.hash] === 'pending' ||
            (recheckTips && c.remotes.length > 0 && states[c.hash] === 'none')
        )
        .map((c) => c.hash)
  }
}

/** 远程分支指向的签名：推送、获取让它变化时，开始一段时间的远程分支末端重查。 */
export function remoteTipsSignature(commits: readonly GitCommit[]): string {
  return commits
    .filter((c) => c.remotes.length > 0)
    .map((c) => `${c.hash}:${c.remotes.map((r) => r.name).join(',')}`)
    .join('|')
}

/**
 * 提交详情的各项检查是否还要定时重查：列表里还有没结束的项，或汇总仍是进行中（列表还没拉到）。
 * 不能只看汇总——GitHub 的汇总失败优先，已有一项失败、其余还在跑时汇总已是失败。
 */
export function checkRunsInProgress(
  rollup: CommitCheckState | undefined,
  runs: readonly CheckRun[] | null
): boolean {
  return rollup === 'pending' || (runs?.some((run) => run.state === 'pending') ?? false)
}

/** 轮询挡位：距上次变化不到 untilMs 时用对应间隔；都超过时用 SLOWEST_POLL_MS。 */
const POLL_TIERS: readonly { untilMs: number; delayMs: number }[] = [
  { untilMs: 5 * 60_000, delayMs: 5_000 },
  { untilMs: 15 * 60_000, delayMs: 10_000 },
  { untilMs: 30 * 60_000, delayMs: 15_000 }
]
const SLOWEST_POLL_MS = 30_000

/**
 * 距上次变化多久 → 下一次轮询的间隔：5 分钟内 5 秒，15 分钟内 10 秒，30 分钟内 15 秒，再往后 30 秒。
 * 刚有变化时紧跟，长时间没动静就放慢，省下同一 GitHub 账号各工具共用的接口额度。
 */
export function pollDelay(sinceChangeMs: number): number {
  return POLL_TIERS.find((tier) => sinceChangeMs < tier.untilMs)?.delayMs ?? SLOWEST_POLL_MS
}

/** 各项检查的签名：某项开始运行、结束、出现或消失时变化（详情轮询据此回到最快一档）。 */
export function checkRunsSignature(runs: readonly CheckRun[] | null): string {
  if (runs === null) return ''
  return runs
    .map((run) => `${run.name}\u0000${run.state}\u0000${run.runningSince ?? ''}`)
    .join('\u0001')
}
