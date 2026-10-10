// 项目的探测快照从哪儿来（docs/prd/wsl-project.md）：本机项目现读；WSL 项目经发行版里的小助手读取并缓存，
// 建树、对账与运行只读缓存——建树时不能访问 `\\wsl.localhost\…`（访问本身就会唤醒发行版）。从未连上的项目没有快照。
import { wslDistroOf, wslToLinuxPath } from '../shared/wsl-path'
import { readDiscoverySnapshot, snapshotFromFiles, type DiscoverySnapshot } from './discovery'
import { connectWsl, wslReadDir, wslReadFile } from './wsl'

const cache = new Map<string, DiscoverySnapshot>()

/** 项目的探测快照；WSL 项目从未连上过（还没读到过）时为 null。 */
export function projectDiscovery(projectPath: string): DiscoverySnapshot | null {
  if (wslDistroOf(projectPath) === null) return readDiscoverySnapshot(projectPath)
  return cache.get(projectPath) ?? null
}

/** 重读一个 WSL 项目的探测快照（需其发行版已连上）；连接断了等读不到时保留旧快照。 */
export async function refreshWslDiscovery(projectPath: string): Promise<void> {
  const wsl = wslToLinuxPath(projectPath)
  if (wsl === null) return
  const file = async (
    name: string,
    names: readonly string[]
  ): Promise<string | null | undefined> => {
    if (!names.includes(name)) return null
    try {
      return (await wslReadFile(wsl.distro, `${wsl.path}/${name}`))?.toString('utf8') ?? null
    } catch {
      return undefined
    }
  }
  try {
    const dir = await wslReadDir(wsl.distro, wsl.path)
    const names = dir.notFound ? null : dir.names
    cache.set(
      projectPath,
      snapshotFromFiles({
        names,
        packageJson: names === null ? null : await file('package.json', names),
        pubspec: names === null ? null : await file('pubspec.yaml', names)
      })
    )
  } catch {
    // 连接断了等：保留旧快照
  }
}

/** WSL 项目还没有快照时先连上读一次（运行引用型配置、探测脚本前要知道命令）；连不上则作罢。 */
export async function ensureWslDiscovery(projectPath: string): Promise<void> {
  const distro = wslDistroOf(projectPath)
  if (distro === null || cache.has(projectPath)) return
  try {
    await connectWsl(distro)
  } catch {
    return
  }
  await refreshWslDiscovery(projectPath)
}

/** 项目移除：丢掉它的快照。 */
export function forgetWslDiscovery(projectPath: string): void {
  cache.delete(projectPath)
}
