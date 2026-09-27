// 绕开代理直连（ADR-0039）：连接从实体网卡出去，不进 TUN 代理的虚拟网卡；目标是域名时，向实体网卡
// 所在网络的 DNS 查真实地址（fake-IP 模式下系统解析出的是代理内部的假地址）。只在 macOS / Windows 提供。
// DevCube 只给 ssh 追加选项：BindAddress 绑定实体网卡的地址；目标是域名时再以 HostName 改连真实地址，
// 并以 HostKeyAlias 让 known_hosts 仍按原主机名核对。

import { execFile } from 'node:child_process'
import { Resolver } from 'node:dns/promises'
import { isIP, isIPv4 } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { promisify } from 'node:util'
import { DEFAULT_SSH_PORT, parseSshConfigValues, sshPortOf } from '../shared/server'

const execFileAsync = promisify(execFile)

/** 实体网卡：本机在这张网卡上的 IPv4 地址，与系统为它配置的 DNS。 */
export interface PhysicalNetwork {
  address: string
  dnsServers: string[]
}

/** 直连的目标：ssh 最终要连的主机名与端口，以及用户自设的 HostKeyAlias。 */
export interface DirectTarget {
  hostName: string
  port: number
  hostKeyAlias: string | null
}

/** 用户 ssh 配置自行指定了连接路径的选项：有任一项时 DevCube 不插手。 */
const USER_ROUTE_KEYS = ['proxyjump', 'proxycommand', 'bindaddress', 'bindinterface']

/**
 * 按 `ssh -G` 的输出取直连目标；用户配置已自行指定连接路径（跳板、代理命令、绑定地址或网卡）时为 null，
 * 表示不插手。`ssh -G` 总会给出 hostname，缺了也按不插手处理。
 */
export function directTargetOf(sshConfigOutput: string): DirectTarget | null {
  const values = parseSshConfigValues(sshConfigOutput)
  const hostName = values.get('hostname')
  if (hostName === undefined || USER_ROUTE_KEYS.some((key) => values.has(key))) return null
  return { hostName, port: sshPortOf(values), hostKeyAlias: values.get('hostkeyalias') ?? null }
}

/** known_hosts 记这台主机用的名字（与 ssh 的写法一致）：22 端口为主机名，其余为 `[主机名]:端口`。 */
export function knownHostsName(hostName: string, port: number): string {
  return port === DEFAULT_SSH_PORT ? hostName : `[${hostName}]:${port}`
}

/**
 * 直连追加的 ssh 选项：从实体网卡的地址出去。realAddress 不为 null（目标是域名，已查到真实地址）时
 * 改连真实地址，并让 known_hosts 仍按原主机名核对；用户已自设 HostKeyAlias 的沿用其设置。
 */
export function buildDirectOptions(
  target: DirectTarget,
  localAddress: string,
  realAddress: string | null
): string[] {
  const options = ['-o', `BindAddress=${localAddress}`]
  if (realAddress === null) return options
  options.push('-o', `HostName=${realAddress}`)
  if (target.hostKeyAlias === null) {
    options.push('-o', `HostKeyAlias=${knownHostsName(target.hostName, target.port)}`)
  }
  return options
}

/** 可以用来连外网的 IPv4 地址：排除 169.254 开头的自动分配地址（没拿到 DHCP 时才会有）。 */
function isUsableIPv4(address: string): boolean {
  return isIPv4(address) && !address.startsWith('169.254.')
}

/** 网卡上第一个可用的 IPv4 地址。 */
export function usableIPv4Of(
  addresses: readonly NetworkInterfaceInfo[] | undefined
): string | null {
  return (
    addresses?.find((a) => a.family === 'IPv4' && !a.internal && isUsableIPv4(a.address))
      ?.address ?? null
  )
}

/** macOS：`scutil` 读 `State:/Network/Global/IPv4` 的输出里的主网卡名。 */
export function parsePrimaryInterface(output: string): string | null {
  return /^\s*PrimaryInterface : (\S+)/m.exec(output)?.[1] ?? null
}

/**
 * macOS：`scutil --dns` 里限定到某张网卡的解析器（「for scoped queries」一节）的 IPv4 DNS 地址，
 * 即系统为这张网卡配置的 DNS（含手动设置的）。
 */
export function parseScopedDnsServers(output: string, iface: string): string[] {
  const scoped = output.split('DNS configuration (for scoped queries)')[1] ?? ''
  const servers: string[] = []
  for (const block of scoped.split(/^resolver #\d+/m)) {
    if (/^\s*if_index : \d+ \((\S+)\)/m.exec(block)?.[1] !== iface) continue
    for (const match of block.matchAll(/^\s*nameserver\[\d+\] : (\S+)/gm)) {
      if (isIPv4(match[1]!)) servers.push(match[1]!)
    }
  }
  return [...new Set(servers)]
}

/**
 * Windows：在已连接的实体网卡里，取默认路由度量（路由度量 + 网卡度量）最小的那张，
 * 每行输出一项「address 地址」或「dns 地址」；没有时不输出。
 */
const WINDOWS_NETWORK_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$physical = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object InterfaceIndex)",
  "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Where-Object { $physical -contains $_.InterfaceIndex } | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1",
  'if ($route) {',
  '  Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | ForEach-Object { "address $($_.IPAddress)" }',
  '  Get-DnsClientServerAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | ForEach-Object { $_.ServerAddresses } | ForEach-Object { "dns $_" }',
  '}'
].join('\n')

/** Windows：解析查询脚本的输出；没有可用的实体网卡时为 null。 */
export function parseWindowsNetwork(output: string): PhysicalNetwork | null {
  const addresses: string[] = []
  const dnsServers: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const [key, value] = line.trim().split(/\s+/)
    if (value === undefined) continue
    if (key === 'address' && isUsableIPv4(value)) addresses.push(value)
    else if (key === 'dns' && isIPv4(value)) dnsServers.push(value)
  }
  const address = addresses[0]
  return address === undefined ? null : { address, dnsServers }
}

async function scutil(args: string[], input = ''): Promise<string> {
  const pending = execFileAsync('/usr/sbin/scutil', args, { timeout: 5000 })
  pending.child.stdin?.end(input)
  return (await pending).stdout
}

/** 现查实体网卡（网络会变，不缓存）；查不到时为 null。 */
async function physicalNetwork(): Promise<PhysicalNetwork | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_NETWORK_SCRIPT],
        { windowsHide: true, timeout: 15_000 }
      )
      return parseWindowsNetwork(stdout)
    }
    const iface = parsePrimaryInterface(await scutil([], 'show State:/Network/Global/IPv4\n'))
    if (iface === null) return null
    const address = usableIPv4Of(networkInterfaces()[iface])
    if (address === null) return null
    return { address, dnsServers: parseScopedDnsServers(await scutil(['--dns']), iface) }
  } catch {
    return null
  }
}

/** 以实体网卡的地址向它的 DNS 查 A 记录：查询不进代理，拿到的是真实地址。查不到时为 null。 */
async function resolveRealAddress(host: string, network: PhysicalNetwork): Promise<string | null> {
  if (network.dnsServers.length === 0) return null
  const resolver = new Resolver({ timeout: 3000, tries: 2 })
  resolver.setLocalAddress(network.address)
  resolver.setServers(network.dnsServers)
  try {
    return (await resolver.resolve4(host))[0] ?? null
  } catch {
    return null
  }
}

/**
 * 直连要追加的 ssh 选项；sshConfigOutput 是该连接目标的 `ssh -G` 输出。用户配置已自行指定连接路径时
 * 不插手（没有选项）。找不到实体网卡、或查不到真实地址时返回原因，不退回经代理连接。
 */
export async function resolveDirectOptions(
  sshConfigOutput: string
): Promise<{ options: string[] } | { failure: string }> {
  const target = directTargetOf(sshConfigOutput)
  if (target === null) return { options: [] }
  const network = await physicalNetwork()
  if (network === null) return { failure: '无法直连：未找到可用的本机网络' }
  if (isIP(target.hostName) !== 0) {
    return { options: buildDirectOptions(target, network.address, null) }
  }
  const realAddress = await resolveRealAddress(target.hostName, network)
  if (realAddress === null) {
    return { failure: `无法直连：未能解析 ${target.hostName} 的真实地址` }
  }
  return { options: buildDirectOptions(target, network.address, realAddress) }
}
