import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DiscoveredScript, PackageManager, RunConfig } from '../shared/types'

// lockfile → 包管理器，按优先级排列。
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm']
]

export const LOCKFILE_NAMES: readonly string[] = LOCKFILES.map(([f]) => f)

/** 纯函数：给定项目根现存的文件名集合，按优先级选出包管理器。 */
export function pickPackageManager(presentFiles: readonly string[]): PackageManager | null {
  for (const [file, pm] of LOCKFILES) {
    if (presentFiles.includes(file)) return pm
  }
  return null
}

/** 纯函数：解析 package.json 文本，取出 string 类型的 scripts；损坏/缺失则空。 */
export function parseScripts(jsonText: string): Record<string, string> {
  try {
    const pkg = JSON.parse(jsonText) as { scripts?: unknown }
    const scripts = pkg?.scripts
    if (!scripts || typeof scripts !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [name, cmd] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof cmd === 'string') out[name] = cmd
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 纯函数：派生 Discovered Script —— package.json scripts 去掉「已晋升为引用型配置」的那些。
 */
export function discoverScripts(
  projectPath: string,
  scripts: Record<string, string>,
  configs: RunConfig[]
): DiscoveredScript[] {
  const promoted = new Set(
    configs
      .filter(
        (c): c is Extract<RunConfig, { kind: 'referenced' }> =>
          c.kind === 'referenced' && c.projectPath === projectPath
      )
      .map((c) => c.scriptName)
  )
  return Object.entries(scripts)
    .filter(([name]) => !promoted.has(name))
    .map(([name, command]) => ({ projectPath, name, command }))
}

// —— IO 包装（依赖 fs，不依赖 electron，便于测试其纯函数） ——

export function detectPackageManager(projectPath: string): PackageManager | null {
  const present = LOCKFILE_NAMES.filter((f) => existsSync(join(projectPath, f)))
  return pickPackageManager(present)
}

export function readScripts(projectPath: string): Record<string, string> {
  const file = join(projectPath, 'package.json')
  if (!existsSync(file)) return {}
  return parseScripts(readFileSync(file, 'utf8'))
}
