// GitHub 账号、提交检查与仓库（docs/prd/github-checks.md、docs/prd/git-remote-github.md，ADR-0054）：设备授权登录、
// 凭证保管、GraphQL 查询，以及列出、新建仓库的 REST 请求。
// 请求一律走 Electron 的 net.fetch（Chromium 网络栈，跟随系统代理）；凭证只在这里解密使用，不下发渲染端。
// 地址解析、查询拼装与响应解析是纯函数，在 github-parse.ts。Octokit 是纯 ESM，从 CJS 主进程动态 import。

import { app, clipboard, net } from 'electron'
import type { request as octokitRequest } from '@octokit/request'
import type {
  CheckRun,
  CommitCheckState,
  GitHubAccount,
  GitHubCreateRepoInput,
  GitHubCreateRepoResult,
  GitHubLoginCode,
  GitHubLoginResult,
  GitHubOrgsResult,
  GitHubReposResult
} from '../shared/github'
import { IPC } from '../shared/ipc'
import { GITHUB_REPO_URL } from '../shared/app-update'
import { broadcast } from './app-window'
import { execGit, resolveRepoRoot } from './git-exec'
import {
  ADD_STAR_MUTATION,
  buildRollupQuery,
  CHECK_RUNS_QUERY,
  createRepoErrorMessage,
  creatableOrgs,
  deviceFlowErrorMessage,
  isCommitHash,
  isInsufficientScopes,
  lastPageOf,
  ORGANIZATIONS_QUERY,
  parseCheckRuns,
  parseGitHubRemote,
  parseRemoteList,
  parseRestRepo,
  parseRollupResponse,
  pickGitHubRepo,
  ROLLUP_BATCH,
  STAR_STATE_QUERY,
  VIEWER_QUERY,
  type CheckContextNode,
  type GitHubRepoRef,
  type OrganizationsData,
  type RestErrorBody,
  type RestRepo,
  type RollupRepository
} from './github-parse'
import { decryptSecret, encryptSecret, passwordUnavailableReason } from './secrets'
import { getGitHubAccountRecord, setGitHubAccountRecord } from './store'

/** DevCube 在 GitHub 上登记的 OAuth App（只用于设备授权，可以公开）。 */
const GITHUB_OAUTH_CLIENT_ID = 'Ov23liMtnJRCOo3PpviQ'

/**
 * repo：读私有仓库的检查结果（OAuth 凭证只有这一档可用），列出与新建（含私有）仓库也在这一档里；read:org：新建仓库时
 * 列出所在的组织。申请 read:org 之前登录的凭证照常可用，只是列不出组织，重新登录即可（ADR-0054）。
 */
const GITHUB_SCOPES = ['repo', 'read:org']

/** 单次查询的超时。 */
const REQUEST_TIMEOUT_MS = 20_000

type OctokitRequest = typeof octokitRequest

let baseRequestPromise: Promise<OctokitRequest> | null = null

/** 走 net.fetch、带 DevCube 标识的请求实例（首次用到时加载 Octokit）。 */
function baseRequest(): Promise<OctokitRequest> {
  baseRequestPromise ??= import('@octokit/request').then(({ request }) =>
    request.defaults({
      headers: { 'user-agent': `DevCube/${app.getVersion()}` },
      request: { fetch: (input: string | Request, init?: RequestInit) => net.fetch(input, init) }
    })
  )
  return baseRequestPromise
}

// —— 账号 ——

/** 当前登录的账号；未登录为 null。 */
export function getGitHubAccount(): GitHubAccount | null {
  const record = getGitHubAccountRecord()
  return record === null ? null : { login: record.login }
}

/** 换账号（登录 / 退出 / 凭证失效），并推给全部窗口。 */
function setAccount(record: { login: string; token: string } | null): void {
  setGitHubAccountRecord(record)
  broadcast(IPC.githubAccountChanged, record === null ? null : { login: record.login })
}

export function logoutGitHub(): void {
  if (getGitHubAccountRecord() !== null) setAccount(null)
}

/** 解出凭证；解不开（换了钥匙串等）视同凭证失效，退出登录。 */
function currentToken(): string | null {
  const record = getGitHubAccountRecord()
  if (record === null) return null
  const token = decryptSecret(record.token)
  if (token === null) setAccount(null)
  return token
}

// —— 登录（设备授权） ——

let loginController: AbortController | null = null

/** 登录失败的说明：GitHub 给了错误码的按码说明，连不上 GitHub 的注明，其余用原始信息。 */
function loginErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { error?: string } } }).response
  const message = error instanceof Error ? error.message : String(error)
  if (response === undefined) return `无法连接 GitHub：${message}`
  return deviceFlowErrorMessage(response.data?.error) ?? message
}

/**
 * 设备授权登录：拿到代码后复制到剪贴板并交给 onCode（验证页由用户在等待框里点开，不自动打开——先让人看清代码），
 * 等用户在网页上授权完再取登录名、加密保存凭证。再次发起会取消进行中的那次。
 */
export async function loginGitHub(
  onCode: (code: GitHubLoginCode) => void
): Promise<GitHubLoginResult> {
  loginController?.abort()
  const controller = new AbortController()
  loginController = controller
  try {
    if (passwordUnavailableReason() !== null) {
      return { status: 'error', message: '系统没有可用的钥匙串，无法安全地保存登录信息' }
    }
    const [{ createOAuthDeviceAuth }, request] = await Promise.all([
      import('@octokit/auth-oauth-device'),
      baseRequest()
    ])
    const auth = createOAuthDeviceAuth({
      clientType: 'oauth-app',
      clientId: GITHUB_OAUTH_CLIENT_ID,
      scopes: GITHUB_SCOPES,
      // 取消即中断进行中的请求；轮询间隔里的等待结束后，下一次请求随即失败收口
      request: request.defaults({ request: { signal: controller.signal } }),
      onVerification: (verification) => {
        if (controller.signal.aborted) return
        clipboard.writeText(verification.user_code)
        onCode({
          userCode: verification.user_code,
          verificationUri: verification.verification_uri
        })
      }
    })
    const { token } = await auth({ type: 'oauth' })
    const { viewer } = await runQuery<{ viewer: { login: string } }>(
      token,
      VIEWER_QUERY,
      {},
      controller.signal
    )
    if (controller.signal.aborted) return { status: 'cancelled' }
    setAccount({ login: viewer.login, token: encryptSecret(token) })
    return { status: 'ok', account: { login: viewer.login } }
  } catch (error) {
    if (controller.signal.aborted) return { status: 'cancelled' }
    return { status: 'error', message: loginErrorMessage(error) }
  } finally {
    if (loginController === controller) loginController = null
  }
}

export function cancelGitHubLogin(): void {
  loginController?.abort()
}

// —— 查询 ——

/** 用凭证跑一条 GraphQL 查询；signal 之外另有超时。 */
async function runQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const [{ withCustomRequest }, request] = await Promise.all([
    import('@octokit/graphql'),
    baseRequest()
  ])
  const graphql = withCustomRequest(
    request.defaults({ headers: { authorization: `bearer ${token}` } })
  )
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return graphql<T>(query, {
    ...variables,
    request: { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) }
  })
}

/** 仓库要查的 GitHub 仓库：取远程的获取地址（git 已按 insteadOf 改写），origin 优先。 */
async function gitHubRepoOf(repoPath: string): Promise<GitHubRepoRef | null> {
  const root = await resolveRepoRoot(repoPath)
  if (root === null) return null
  const result = await execGit(root, ['remote', '-v'])
  if (result.code !== 0) return null
  return pickGitHubRepo(parseRemoteList(result.stdout.toString('utf8')))
}

/** 仓库有没有指向 github.com 的远程（Git Tab 据此显示登录入口）。 */
export async function hasGitHubRepo(repoPath: string): Promise<boolean> {
  return (await gitHubRepoOf(repoPath)) !== null
}

/**
 * 用凭证跑一条 GraphQL 请求，失败折叠为 null：GraphQL 部分出错时用随错误带回的那部分数据；
 * 凭证被拒（401）即退出登录。
 */
async function safeQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  try {
    return await runQuery<T>(token, query, variables)
  } catch (error) {
    if ((error as { status?: number }).status === 401) setAccount(null)
    if ((error as Error).name === 'GraphqlResponseError') {
      return ((error as { data?: T | null }).data ?? null) as T | null
    }
    return null
  }
}

/** 对某个 GitHub 仓库跑一条查询（带上 $owner / $name），失败同 safeQuery。 */
function queryRepo<T>(
  token: string,
  repo: GitHubRepoRef,
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  return safeQuery<T>(token, query, { owner: repo.owner, name: repo.name, ...variables })
}

/** 查检查所需的凭证与 GitHub 仓库；任一缺失为 null。 */
async function target(repoPath: string): Promise<{ token: string; repo: GitHubRepoRef } | null> {
  const token = currentToken()
  if (token === null) return null
  const repo = await gitHubRepoOf(repoPath)
  return repo === null ? null : { token, repo }
}

/** 一批提交的检查汇总（每 ROLLUP_BATCH 个一次请求，依次发出；某批查不到即停）。 */
export async function getCommitChecks(
  repoPath: string,
  hashes: string[]
): Promise<Record<string, CommitCheckState>> {
  const states: Record<string, CommitCheckState> = {}
  const valid = hashes.filter(isCommitHash)
  if (valid.length === 0) return states
  const t = await target(repoPath)
  if (t === null) return states
  for (let i = 0; i < valid.length; i += ROLLUP_BATCH) {
    const batch = valid.slice(i, i + ROLLUP_BATCH)
    const data = await queryRepo<{ repository: RollupRepository | null }>(
      t.token,
      t.repo,
      buildRollupQuery(batch),
      {}
    )
    if (data?.repository == null) break
    Object.assign(states, parseRollupResponse(data.repository, batch))
  }
  return states
}

interface CheckRunsData {
  repository: {
    object: {
      statusCheckRollup?: { contexts: { nodes: (CheckContextNode | null)[] } } | null
    } | null
  } | null
}

/** 一个提交的各项检查；没有任何检查为空数组，查不到为 null。 */
export async function getCheckRuns(repoPath: string, hash: string): Promise<CheckRun[] | null> {
  if (!isCommitHash(hash)) return null
  const t = await target(repoPath)
  if (t === null) return null
  const data = await queryRepo<CheckRunsData>(t.token, t.repo, CHECK_RUNS_QUERY, { oid: hash })
  if (data?.repository == null) return null
  const nodes = data.repository.object?.statusCheckRollup?.contexts.nodes ?? []
  return parseCheckRuns(nodes.filter((n): n is CheckContextNode => n !== null))
}

// —— 仓库（docs/prd/git-remote-github.md）：列出与新建走 REST，新建时可选的组织走 GraphQL ——

/** REST 列表每页的条数（GitHub 的上限）。 */
const REST_PER_PAGE = 100

/** 用凭证发一个 REST 请求，带超时；返回响应体与分页的 link 头。出错原样抛出（说明由 requestErrorMessage 整理）。 */
async function restRequest<T>(
  token: string,
  route: string,
  params: Record<string, unknown>
): Promise<{ data: T; link: string | undefined }> {
  const request = await baseRequest()
  const { data, headers } = await request(route, {
    ...params,
    headers: { authorization: `bearer ${token}` },
    request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  })
  return { data: data as T, link: headers.link }
}

/**
 * 请求失败的说明（REST 与 GraphQL 共用）：连不上 GitHub 的注明，凭证被拒（401）即退出登录，其余用 detail 整理出的说明
 * （没有则原始信息）。
 */
function requestErrorMessage(
  error: unknown,
  detail: (body: RestErrorBody | undefined) => string | null = (body) => body?.message ?? null
): string {
  const { status, response } = error as { status?: number; response?: { data?: RestErrorBody } }
  const message = error instanceof Error ? error.message : String(error)
  // GraphQL 的出错随 200 响应带回（逐项原因已在 message 里），不是连不上
  if ((error as Error).name === 'GraphqlResponseError') return message
  if (response === undefined) return `无法连接 GitHub：${message}`
  if (status === 401) {
    setAccount(null)
    return 'GitHub 登录已失效，请重新登录'
  }
  return detail(response.data) ?? message
}

/**
 * 当前账号能访问的全部仓库（自己的、参与协作的、所在组织的），最近推送的在前。先读第一页，从 link 头得知共几页后，
 * 其余各页同时读，按页序拼起来。
 */
export async function listGitHubRepos(): Promise<GitHubReposResult> {
  const token = currentToken()
  if (token === null) return { status: 'error', message: '未登录 GitHub' }
  const page = (n: number): Promise<{ data: RestRepo[]; link: string | undefined }> =>
    restRequest<RestRepo[]>(token, 'GET /user/repos', {
      sort: 'pushed',
      per_page: REST_PER_PAGE,
      page: n
    })
  try {
    const first = await page(1)
    const rest = await Promise.all(
      Array.from({ length: lastPageOf(first.link) - 1 }, (_, i) => page(i + 2))
    )
    const repos = [first, ...rest].flatMap((p) => p.data.map(parseRestRepo))
    return { status: 'ok', repos }
  } catch (error) {
    return { status: 'error', message: requestErrorMessage(error) }
  }
}

/**
 * 新建仓库时可选的组织：当前账号能在其中新建仓库的，逐页读完。凭证缺 read:org（申请它之前登录的）时列不出，
 * 标明 orgScopeMissing，由界面引导重新登录。
 */
export async function listGitHubOrgs(): Promise<GitHubOrgsResult> {
  const token = currentToken()
  if (token === null) return { status: 'error', message: '未登录 GitHub' }
  try {
    const orgs: string[] = []
    let cursor: string | null = null
    for (;;) {
      const data: OrganizationsData = await runQuery<OrganizationsData>(
        token,
        ORGANIZATIONS_QUERY,
        { cursor }
      )
      orgs.push(...creatableOrgs(data))
      const { hasNextPage, endCursor } = data.viewer.organizations.pageInfo
      if (!hasNextPage || endCursor === null) return { status: 'ok', orgs, orgScopeMissing: false }
      cursor = endCursor
    }
  } catch (error) {
    if (isInsufficientScopes(error)) return { status: 'ok', orgs: [], orgScopeMissing: true }
    return { status: 'error', message: requestErrorMessage(error) }
  }
}

/** 在当前账号或组织下新建一个空仓库。 */
export async function createGitHubRepo(
  input: GitHubCreateRepoInput
): Promise<GitHubCreateRepoResult> {
  const token = currentToken()
  if (token === null) return { status: 'error', message: '未登录 GitHub' }
  try {
    const route = input.org === null ? 'POST /user/repos' : 'POST /orgs/{org}/repos'
    const { data: repo } = await restRequest<RestRepo>(token, route, {
      ...(input.org === null ? {} : { org: input.org }),
      name: input.name,
      ...(input.description === '' ? {} : { description: input.description }),
      private: input.isPrivate
    })
    return { status: 'ok', repo: parseRestRepo(repo) }
  } catch (error) {
    return {
      status: 'error',
      message: requestErrorMessage(error, (body) => createRepoErrorMessage(input.name, body))
    }
  }
}

// —— DevCube 仓库的星标（关于页） ——

/** DevCube 自己在 GitHub 上的仓库。 */
const DEVCUBE_REPO = parseGitHubRemote(GITHUB_REPO_URL)

/** 仓库的节点 id（加星标要用）：读状态时记下，之后加星不必再查一遍；仓库不变，id 也不变。 */
let devCubeRepoId: string | null = null

/** 当前账号有没有给 DevCube 加星标（顺带记下仓库节点 id）；未登录或查不到为 null。 */
export async function getDevCubeStarred(): Promise<boolean | null> {
  const token = currentToken()
  if (token === null || DEVCUBE_REPO === null) return null
  const data = await queryRepo<{ repository: { id: string; viewerHasStarred: boolean } | null }>(
    token,
    DEVCUBE_REPO,
    STAR_STATE_QUERY,
    {}
  )
  if (data?.repository == null) return null
  devCubeRepoId = data.repository.id
  return data.repository.viewerHasStarred
}

/**
 * 给 DevCube 加星标（只在用户点按钮时调用；不提供取消），返回之后的状态；失败为 null。
 * 关于页先读过状态，仓库节点 id 已记下，通常只发这一个请求。
 */
export async function starDevCube(): Promise<boolean | null> {
  if (devCubeRepoId === null) await getDevCubeStarred()
  const token = currentToken()
  if (token === null || devCubeRepoId === null) return null
  const data = await safeQuery<{ addStar: { starrable: { viewerHasStarred: boolean } } | null }>(
    token,
    ADD_STAR_MUTATION,
    { id: devCubeRepoId }
  )
  return data?.addStar?.starrable.viewerHasStarred ?? null
}
