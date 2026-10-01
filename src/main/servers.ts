// 服务器（Server）登记、`~/.ssh/config` 读取与测试连接；术语见 CONTEXT.md，取舍见 ADR-0038、ADR-0041。
// DevCube 只在自己的集中配置里记服务器，从不改写 `~/.ssh/config`。

import { randomUUID } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { LineType, parse, type Line } from 'ssh-config'
import type { ConnectionTestResult, PasswordChange } from '../shared/connection'
import {
  connectableHostAliases,
  serverTargetLabel,
  sshArgs,
  type Server,
  type ServerInput,
  type ServerNode,
  type ServerTarget,
  type ServerTestInput,
  type SshConfigHost
} from '../shared/server'
import { parseSshConfigHost } from '../shared/ssh-config'
import type { RemoteRunConfig } from '../shared/types'
import { createConnectionTester } from './connection-test'
import { applyServerPassword, hasSavedPassword } from './server-secrets'
import { connectSsh, resolveSsh, sshConfigOutput } from './ssh-connect'
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

/**
 * 登记服务器，返回新登记的 id（按输入顺序），按输入顺序整体插到左树自定义序最前。连接目标与已登记的相同也照样登记
 * （允许重复，对话框里提交前已确认过）。
 */
export function addServers(inputs: ServerInput[]): string[] {
  const servers = getServers()
  const now = Date.now()
  const created: { server: Server; password: PasswordChange }[] = []
  for (const input of inputs) {
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
  }
  const base = headOrder() - created.length
  created.forEach(({ server }, i) => (server.order = base + i))
  setServers([...created.map((c) => c.server), ...servers])
  for (const { server, password } of created) applyServerPassword(server.id, password)
  return created.map(({ server }) => server.id)
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
  applyServerPassword(id, input.password)
}

export function removeServer(id: string): void {
  setServers(getServers().filter((s) => s.id !== id))
  applyServerPassword(id, null)
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

/** `ssh -G <目标>`：ssh 自己算出的最终连接配置，与真正连接时一致。 */
function sshEffectiveConfig(
  ssh: string,
  target: ServerTarget,
  env: NodeJS.ProcessEnv
): Promise<string> {
  return sshConfigOutput(ssh, env, sshArgs(target))
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
      parseSshConfigHost(
        alias,
        await sshEffectiveConfig(ssh, { kind: 'config', alias }, env).catch(() => '')
      )
    )
  )
}

// —— 测试连接 ——

const serverTester = createConnectionTester()

/**
 * 测试连接：用表单当前的连接目标经内置连接登录（ADR-0041），认证通过即断开。
 * 只检验表单里的内容：密码只用表单里填的（或记住的）答一次，不弹给用户、也不记住；
 * 其余提问（主机指纹、私钥口令、验证码）照常弹窗。同一时刻只测一个、有总时限（见 createConnectionTester）。
 */
export function testServerConnection(input: ServerTestInput): Promise<ConnectionTestResult> {
  return serverTester.run(
    async (signal) => {
      const { client } = await connectSsh({
        target: input.target,
        direct: input.direct,
        serverId: input.serverId,
        password: input.password,
        testing: true,
        signal
      })
      client.end()
    },
    (error) => (error instanceof Error ? error.message : String(error))
  )
}

/** 取消进行中的测试连接（对话框关闭时）。 */
export function cancelServerTest(): void {
  serverTester.cancel()
}
