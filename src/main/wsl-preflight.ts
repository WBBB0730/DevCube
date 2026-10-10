// WSL 连接前的检查（docs/prd/wsl-project.md「连不上」）：连接失败时给出能看懂、能照着修的原因，
// 而不是 wsl.exe 的原始报错。只在连接时跑，结果不缓存（用户可能刚装好或刚转换完）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 注册表里登记的一个发行版。 */
export interface WslDistroInfo {
  name: string
  /** WSL 1 / WSL 2：看 Flags 的 0x8 位（VM 模式），不看 Version（那是文件系统布局的版本） */
  wsl2: boolean
}

const LXSS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
/** LXSS_DISTRO_FLAGS_VM_MODE（microsoft/WSL 源码 DistributionRegistration.h） */
const VM_MODE_FLAG = 0x8

/** 解析 `reg query <Lxss> /s` 的输出：每个发行版子键取 DistributionName 与 Flags。 */
export function parseLxssRegistry(output: string): WslDistroInfo[] {
  const distros: WslDistroInfo[] = []
  let name: string | null = null
  let flags = 0
  const flush = (): void => {
    if (name !== null) distros.push({ name, wsl2: (flags & VM_MODE_FLAG) !== 0 })
    name = null
    flags = 0
  }
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush()
      continue
    }
    const value = /^\s+(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line)
    if (!value) continue
    if (value[1] === 'DistributionName') name = value[3].trim()
    else if (value[1] === 'Flags') flags = Number.parseInt(value[3].trim(), 16) || 0
  }
  flush()
  return distros
}

/** 连接前检查需要的事实（注入以便测试）。 */
export interface WslPreflightFacts {
  /** `wsl.exe --version` 能跑通（Microsoft Store 版 WSL 才有这个参数） */
  storeWsl: boolean
  distros: readonly WslDistroInfo[]
  /** 安装包里带了小助手 */
  helperPresent: boolean
}

/** 连不上的原因；能连返回 null。发行版名不分大小写（WSL 自己就不分）。 */
export function wslPreflightReason(distro: string, facts: WslPreflightFacts): string | null {
  if (!facts.storeWsl && facts.distros.length === 0) return '未安装 WSL'
  if (!facts.storeWsl) return 'WSL 版本过旧，请运行 wsl --update 更新'
  const info = facts.distros.find((d) => d.name.toLowerCase() === distro.toLowerCase())
  if (!info) return `未找到发行版 ${distro}`
  if (!info.wsl2)
    return `${distro} 是 WSL 1 发行版，请先运行 wsl --set-version ${distro} 2 转换为 WSL 2`
  if (!facts.helperPresent) return 'DevCube 缺少 WSL 组件，请重新安装'
  return null
}

/** 读注册表里登记的发行版；没有这个键（从没装过发行版）即为空。 */
export async function readWslDistros(): Promise<WslDistroInfo[]> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', LXSS_KEY, '/s'], { windowsHide: true })
    return parseLxssRegistry(stdout)
  } catch {
    return []
  }
}

/** Microsoft Store 版 WSL 才认 `--version`；系统自带的旧版与未安装时的占位 wsl.exe 都会报错退出。 */
export async function isStoreWsl(wslExe: string): Promise<boolean> {
  try {
    await execFileAsync(wslExe, ['--version'], { windowsHide: true, timeout: 15_000 })
    return true
  } catch {
    return false
  }
}
