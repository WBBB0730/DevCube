// GitHub 提交检查的纯函数层（docs/prd/github-checks.md）：远程地址 → 仓库、GraphQL 查询拼装、响应 → 检查结果。
// 不访问网络、不依赖 electron，供 main/github.ts 编排与单测。

import type { CheckRun, CheckRunState, CommitCheckState } from '../shared/github'

/** GitHub 上的一个仓库（owner/name）。 */
export interface GitHubRepoRef {
  owner: string
  name: string
}

/** github.com 的各种主机名：网页、SSH，以及走 443 端口的 SSH。 */
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'ssh.github.com'])

/** 带 scheme 的地址（https / ssh / git 等）。 */
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** scp 形式 [user@]host:path（冒号后不能紧跟斜杠，否则是 scheme）。 */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/

/** 仓库路径 owner/name，容许末尾的 .git 与斜杠。 */
const REPO_PATH = /^\/?([^/]+)\/([^/]+?)(?:\.git)?\/?$/

/**
 * 远程地址 → github.com 上的仓库；不是 github.com（含 GitHub Enterprise、SSH 主机别名）为 null。
 * 认 https / http / ssh / git 协议与 scp 形式（git@github.com:owner/repo.git）。
 */
export function parseGitHubRemote(url: string): GitHubRepoRef | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  if (URL_WITH_SCHEME.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    host = parsed.hostname
    path = parsed.pathname
  } else {
    const scp = SCP_LIKE.exec(trimmed)
    if (scp === null) return null
    host = scp[1]
    path = scp[2]
  }
  if (!GITHUB_HOSTS.has(host.toLowerCase())) return null
  const repo = REPO_PATH.exec(path)
  return repo === null ? null : { owner: repo[1], name: repo[2] }
}

/** `git remote -v` 的输出 → 各远程的获取地址（push 行略去；地址已按 insteadOf 改写）。 */
export function parseRemoteList(stdout: string): { name: string; url: string }[] {
  const remotes: { name: string; url: string }[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(\S+)\s+(.+?)\s+\(fetch\)$/.exec(line)
    if (m !== null) remotes.push({ name: m[1], url: m[2] })
  }
  return remotes
}

/** 查检查结果用哪个仓库：origin 指向 GitHub 就用它，否则取第一个指向 GitHub 的远程。 */
export function pickGitHubRepo(remotes: { name: string; url: string }[]): GitHubRepoRef | null {
  const ordered = [
    ...remotes.filter((r) => r.name === 'origin'),
    ...remotes.filter((r) => r.name !== 'origin')
  ]
  for (const remote of ordered) {
    const repo = parseGitHubRemote(remote.url)
    if (repo !== null) return repo
  }
  return null
}

/** 能拿去 GitHub 查的提交 hash（SHA-1 全长；拼进查询前必须过这一道）。 */
export function isCommitHash(hash: string): boolean {
  return /^[0-9a-f]{40}$/.test(hash)
}

/** 一次查询最多带多少个提交（GraphQL 别名数）。 */
export const ROLLUP_BATCH = 100

/** 查一批提交的检查汇总：每个提交一个别名 c<i>。hash 须已经过 isCommitHash。 */
export function buildRollupQuery(hashes: readonly string[]): string {
  const fields = hashes
    .map((h, i) => `c${i}: object(oid: "${h}") { ... on Commit { statusCheckRollup { state } } }`)
    .join('\n')
  return `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${fields}
  }
}`
}

/** 一个提交的各项检查（CheckRun 为 Checks API 的结果，含 Actions 作业；StatusContext 为提交状态）。 */
export const CHECK_RUNS_QUERY = `query($owner: String!, $name: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                detailsUrl
                permalink
                startedAt
                completedAt
                checkSuite { workflowRun { workflow { name } } }
              }
              ... on StatusContext {
                context
                state
                targetUrl
              }
            }
          }
        }
      }
    }
  }
}`

/** 当前账号的登录名。 */
export const VIEWER_QUERY = 'query { viewer { login } }'

/** 仓库的节点 id 与当前账号是否已加星标（关于页的星标按钮）。 */
export const STAR_STATE_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id viewerHasStarred }
}`

/** 加星标，返回之后的状态（不提供取消：关于页只让人加星）。 */
export const ADD_STAR_MUTATION = `mutation($id: ID!) {
  addStar(input: { starrableId: $id }) { starrable { viewerHasStarred } }
}`

/** GitHub 的 StatusState → 检查汇总；不认识的值按没有检查。 */
export function rollupState(state: string | null | undefined): CommitCheckState {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

/** buildRollupQuery 的响应里 repository 那一层：别名 → 提交（GitHub 上没有为 null）。 */
export type RollupRepository = Record<
  string,
  { statusCheckRollup?: { state?: string } | null } | null
>

/**
 * 汇总查询的响应 → 每个提交的检查汇总。响应里没有的别名（部分出错）不进结果，下回再查；
 * 提交不存在或没有任何检查为 none。
 */
export function parseRollupResponse(
  repository: RollupRepository,
  hashes: readonly string[]
): Record<string, CommitCheckState> {
  const states: Record<string, CommitCheckState> = {}
  hashes.forEach((hash, i) => {
    const node = repository[`c${i}`]
    if (node === undefined) return
    states[hash] = node === null ? 'none' : rollupState(node.statusCheckRollup?.state)
  })
  return states
}

interface CheckRunNode {
  __typename: 'CheckRun'
  name: string
  status: string
  conclusion: string | null
  detailsUrl: string | null
  permalink: string | null
  startedAt: string | null
  completedAt: string | null
  checkSuite: { workflowRun: { workflow: { name: string } | null } | null } | null
}

interface StatusContextNode {
  __typename: 'StatusContext'
  context: string
  state: string
  targetUrl: string | null
}

/** CHECK_RUNS_QUERY 的 contexts.nodes 里的一项。 */
export type CheckContextNode = CheckRunNode | StatusContextNode

/** Checks API 的结论 → 单项检查的结果：没完成为进行中；跳过、取消、中性、过期不算成败。 */
function checkRunState(status: string, conclusion: string | null): CheckRunState {
  if (status !== 'COMPLETED') return 'pending'
  switch (conclusion) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'STARTUP_FAILURE':
    case 'ACTION_REQUIRED':
      return 'failure'
    default:
      return 'neutral'
  }
}

/** 两个 ISO 时间之间的秒数；缺一端为 null。 */
function durationBetween(startedAt: string | null, completedAt: string | null): number | null {
  if (startedAt === null || completedAt === null) return null
  const ms = Date.parse(completedAt) - Date.parse(startedAt)
  return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / 1000))
}

/** ISO 时间 → Unix 秒；解析不了为 null。 */
function unixSeconds(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** 各项检查的响应节点 → 详情列表（顺序同 GitHub 返回）。 */
export function parseCheckRuns(nodes: readonly CheckContextNode[]): CheckRun[] {
  return nodes.map((node) => {
    if (node.__typename === 'StatusContext') {
      const state = rollupState(node.state)
      return {
        name: node.context,
        state: state === 'none' ? 'neutral' : state,
        url: node.targetUrl,
        durationSec: null,
        runningSince: null
      }
    }
    const workflow = node.checkSuite?.workflowRun?.workflow?.name
    return {
      name: workflow === undefined ? node.name : `${workflow} / ${node.name}`,
      state: checkRunState(node.status, node.conclusion),
      url: node.detailsUrl ?? node.permalink,
      durationSec: durationBetween(node.startedAt, node.completedAt),
      // 只有正在运行的才计已运行时长：排队中的开始时间不算数（排队不是运行）
      runningSince: node.status === 'IN_PROGRESS' ? unixSeconds(node.startedAt) : null
    }
  })
}

/** 设备授权失败的错误码 → 给用户看的说明；不认识的返回 null（由调用方用原始信息）。 */
export function deviceFlowErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'access_denied':
      return '已在 GitHub 上拒绝授权'
    case 'expired_token':
      return '代码已过期，请重新登录'
    default:
      return null
  }
}
