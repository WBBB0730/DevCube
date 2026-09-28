// 服务器（Server）登记与 `~/.ssh/config` 读取；术语见 CONTEXT.md，取舍见 ADR-0038。
// DevCube 只在自己的集中配置里记服务器，从不改写 `~/.ssh/config`。

import { execFile, type ExecFileException } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { LineType, parse, type Line } from 'ssh-config'
import {
  connectableHostAliases,
  parseSshConfigValues,
  parseSshEffectiveConfig,
  sameServerTarget,
  serverTargetLabel,
  sshArgs,
  sshFailureMessage,
  sshTestArgs,
  supportsSshDirect,
  type PasswordChange,
  type Server,
  type ServerInput,
  type ServerNode,
  type ServerTarget,
  type ServerTestInput,
  type ServerTestResult,
  type SshConfigHost
} from '../shared/server'
import type { RemoteRunConfig } from '../shared/types'
import { beginAskpassConnection, endAskpassConnection } from './askpass'
import { findOnPath, withTerminalLocale } from './command'
import { forgetPassword, hasSavedPassword, savePassword } from './server-secrets'
import { resolveShellEnvironment } from './shell-env'
import { resolveDirectOptions } from './ssh-direct'
import { getConfigs, getServers, setServers } from './store'
import { headOrder } from './tree-order'

export function listServerNodes(): ServerNode[] {
  const configs = getConfigs()
  return getServers().map((server) => ({
    server,
    hasPassword: hasSavedPassword(server.id),
    configs: configs.filter(
      (c): c is RemoteRunConfig => c.kind === 'remote' && c.serverId === server.id
    )
  }))
}

export function findServer(id: string): Server | null {
  return getServers().find((s) => s.id === id) ?? null
}

function applyPassword(serverId: string, password: PasswordChange): void {
  if (password === undefined) return
  if (password === null) forgetPassword(serverId)
  else savePassword(serverId, password)
}

/**
 * 登记服务器，返回应聚焦的 id（按输入顺序）。连接目标与已登记的相同则不重复登记、直接命中。
 * 新登记的按输入顺序整体插到左树自定义序最前。
 */
export function addServers(inputs: ServerInput[]): string[] {
  const servers = getServers()
  const now = Date.now()
  const created: { server: Server; password: PasswordChange }[] = []
  const focusIds: string[] = []
  for (const input of inputs) {
    const existing = [...servers, ...created.map((c) => c.server)].find((s) =>
      sameServerTarget(s.target, input.target)
    )
    if (existing) {
      focusIds.push(existing.id)
      continue
    }
    const server: Server = {
      id: randomUUID(),
      name: input.name.trim() || serverTargetLabel(input.target),
      target: input.target,
      addedAt: now,
      lastOpenedAt: now,
      pinned: false,
      order: 0,
      direct: input.direct
    }
    created.push({ server, password: input.password })
    focusIds.push(server.id)
  }
  const base = headOrder() - created.length
  created.forEach(({ server }, i) => (server.order = base + i))
  setServers([...created.map((c) => c.server), ...servers])
  for (const { server, password } of created) applyPassword(server.id, password)
  return focusIds
}

export function updateServer(id: string, input: ServerInput): void {
  setServers(
    getServers().map((s) =>
      s.id === id
        ? {
            ...s,
            name: input.name.trim() || serverTargetLabel(input.target),
            target: input.target,
            direct: input.direct
          }
        : s
    )
  )
  applyPassword(id, input.password)
}

export function removeServer(id: string): void {
  setServers(getServers().filter((s) => s.id !== id))
  forgetPassword(id)
}

export function touchServer(id: string): void {
  const now = Date.now()
  setServers(getServers().map((s) => (s.id === id ? { ...s, lastOpenedAt: now } : s)))
}

// —— ~/.ssh/config ——

function directiveValues(line: Line): string[] {
  if (line.type !== LineType.DIRECTIVE) return []
  return typeof line.value === 'string' ? [line.value] : line.value.map((v) => v.val)
}

/**
 * Include 路径展开（ssh_config(5)）：`~` 开头展开到用户目录；相对路径相对 `~/.ssh`；
 * 可含通配符（glob(3)），多个匹配按字典序。
 */
function expandInclude(pattern: string): string[] {
  const home = homedir()
  const withHome = pattern.startsWith('~') ? join(home, pattern.slice(1)) : pattern
  const full = isAbsolute(withHome) ? withHome : join(home, '.ssh', withHome)
  if (!/[*?[]/.test(full)) return [full]
  try {
    return globSync(full).sort()
  } catch {
    return []
  }
}

/** 递归收集配置文件（含 Include）里全部 Host 模式；Include 可以写在 Host / Match 块内，同样展开。 */
function collectHostPatterns(file: string, seen: Set<string>, out: string[]): void {
  if (seen.has(file)) return
  seen.add(file)
  let lines: Line[]
  try {
    lines = parse(readFileSync(file, 'utf8'))
  } catch {
    return
  }
  const walk = (block: Line[]): void => {
    for (const line of block) {
      if (line.type !== LineType.DIRECTIVE) continue
      const param = line.param.toLowerCase()
      if (param === 'host') out.push(...directiveValues(line))
      else if (param === 'include') {
        for (const pattern of directiveValues(line)) {
          for (const included of expandInclude(pattern)) collectHostPatterns(included, seen, out)
        }
      }
      if ('config' in line) walk(line.config)
    }
  }
  walk(lines)
}

const execFileAsync = promisify(execFile)

/** `ssh -G <目标>`：ssh 自己算出的最终连接配置，与真正连接时一致。 */
async function sshEffectiveConfig(
  ssh: string,
  target: ServerTarget,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return (await execFileAsync(ssh, ['-G', ...sshArgs(target)], { env, timeout: 5000 })).stdout
}

/** 连接目标最终连到的主机名或 IP（`ssh -G` 的 hostname）；读不到为空串。 */
export async function sshHostNameOf(
  ssh: string,
  env: NodeJS.ProcessEnv,
  target: ServerTarget
): Promise<string> {
  try {
    return parseSshConfigValues(await sshEffectiveConfig(ssh, target, env)).get('hostname') ?? ''
  } catch {
    return ''
  }
}

/** `~/.ssh/config`（含 Include）里可直接连接的主机，按出现顺序去重；读不到配置或找不到 ssh 时为空。 */
export async function listSshConfigHosts(): Promise<SshConfigHost[]> {
  const patterns: string[] = []
  collectHostPatterns(join(homedir(), '.ssh', 'config'), new Set(), patterns)
  const aliases = [...new Set(connectableHostAliases(patterns))]
  const { ssh, env } = await resolveSsh()
  if (!ssh) return []
  return Promise.all(
    aliases.map(async (alias) =>
      parseSshEffectiveConfig(
        alias,
        await sshEffectiveConfig(ssh, { kind: 'config', alias }, env).catch(() => '')
      )
    )
  )
}

// —— ssh 进程 ——

export const SSH_NOT_FOUND = '未找到 ssh，请安装 OpenSSH 客户端或将其加入 PATH'

/** 登录 shell 环境里的 ssh（与用户终端里敲的是同一个）与该环境；找不到 ssh 时为 null。 */
async function resolveSsh(): Promise<{ ssh: string | null; env: NodeJS.ProcessEnv }> {
  const env = withTerminalLocale({ ...process.env, ...(await resolveShellEnvironment()) })
  return { ssh: findOnPath('ssh', env), env }
}

/** 从 ssh 的报错里取出说明（最后一行，没有输出时给退出代码）。 */
function sshErrorMessage(error: unknown): string {
  const { code, stderr } = error as ExecFileException & { stderr?: string }
  return sshFailureMessage(stderr ?? '', typeof code === 'number' ? code : null)
}

/**
 * 起 ssh 之前的准备：登录 shell 环境里的 ssh 与该环境，以及要追加的 ssh 选项——该服务器打开了
 * 绕开代理直连、且平台支持时，按 `ssh -G` 的结果算出直连选项（ADR-0039）。准备不成时返回原因。
 */
export async function prepareSsh(
  target: ServerTarget,
  direct: boolean
): Promise<{ ssh: string; env: NodeJS.ProcessEnv; options: string[] } | { failure: string }> {
  const { ssh, env } = await resolveSsh()
  if (!ssh) return { failure: SSH_NOT_FOUND }
  if (!direct || !supportsSshDirect(process.platform)) return { ssh, env, options: [] }
  let config: string
  try {
    config = await sshEffectiveConfig(ssh, target, env)
  } catch (error) {
    return { failure: sshErrorMessage(error) }
  }
  const resolved = await resolveDirectOptions(config)
  return 'failure' in resolved ? resolved : { ssh, env, options: resolved.options }
}

/** 测试连接的总时限：含用户回答提问（确认指纹、输密码）的时间。 */
const TEST_TIMEOUT_MS = 120_000

/** 进行中的测试连接；进函数即登记，准备阶段（解析登录 shell 环境）被取消也不会漏。 */
let activeTest: AbortController | null = null

/**
 * 测试连接：用表单当前的连接目标起系统 ssh，登录后在服务器上立即 `exit`（ADR-0038）。
 * 只检验表单里的内容：密码只用表单里填的（或记住的）答一次，不弹给用户、也不记住；
 * 其余提问（指纹确认、私钥口令、验证码）照常经 askpass 弹窗。
 * 同一时刻只测一个：新测试会取消旧的，旧的以 canceled 收口。
 */
export async function testServerConnection(input: ServerTestInput): Promise<ServerTestResult> {
  activeTest?.abort()
  const controller = new AbortController()
  activeTest = controller
  try {
    const prepared = await prepareSsh(input.target, input.direct)
    if (controller.signal.aborted) return { status: 'canceled' }
    if ('failure' in prepared) return { status: 'failed', message: prepared.failure }
    const token = randomUUID()
    // 密码被拒或根本没有密码：立即结束 ssh，以这句作为测试结果
    const passwordFailure = new AbortController()
    const askpassEnv = await beginAskpassConnection(token, {
      serverId: input.serverId,
      serverName: input.name.trim() || serverTargetLabel(input.target),
      password: input.password,
      onTestPasswordFailure: (rejected) =>
        passwordFailure.abort(rejected ? '密码错误' : '服务器要求输入密码，请先填写后再测试')
    })
    try {
      controller.signal.throwIfAborted()
      await execFileAsync(prepared.ssh, sshTestArgs(input.target, prepared.options), {
        cwd: homedir(),
        env: { ...prepared.env, ...askpassEnv },
        signal: AbortSignal.any([controller.signal, passwordFailure.signal]),
        timeout: TEST_TIMEOUT_MS
      })
      return { status: 'ok' }
    } catch (error) {
      if (controller.signal.aborted) return { status: 'canceled' }
      if (passwordFailure.signal.aborted) {
        return { status: 'failed', message: String(passwordFailure.signal.reason) }
      }
      if ((error as ExecFileException).killed) return { status: 'failed', message: '连接超时' }
      return { status: 'failed', message: sshErrorMessage(error) }
    } finally {
      endAskpassConnection(token)
    }
  } finally {
    if (activeTest === controller) activeTest = null
  }
}

/** 取消进行中的测试连接（对话框关闭时）。 */
export function cancelServerTest(): void {
  activeTest?.abort()
}
