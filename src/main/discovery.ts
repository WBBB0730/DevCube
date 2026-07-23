import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { discoverRefKey } from '../shared/discover-key'
import { SCRIPT_SOURCE, type DiscoverSource } from '../shared/discover-source'
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

/** 约定指纹用的固定文件名（.NET 工程文件另按扩展名枚举）。 */
export const CONVENTION_WATCH_FILES: readonly string[] = [
  'go.mod',
  'Cargo.toml',
  'pubspec.yaml',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml'
]

const COMPOSE_FILES = new Set([
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml'
])

/** 项目根指纹事实（纯函数输入；由 IO 层采集）。 */
export interface ProjectFingerprints {
  hasGoMod: boolean
  hasCargoToml: boolean
  isFlutter: boolean
  hasDotnet: boolean
  hasCompose: boolean
}

type ConventionEntry = readonly [name: string, command: string]

const CONVENTIONS: ReadonlyArray<{
  source: Exclude<DiscoverSource, 'scripts'>
  when: (fp: ProjectFingerprints) => boolean
  entries: readonly ConventionEntry[]
}> = [
  {
    source: 'go',
    when: (fp) => fp.hasGoMod,
    entries: [
      ['run', 'go run .'],
      ['test', 'go test ./...'],
      ['build', 'go build']
    ]
  },
  {
    source: 'cargo',
    when: (fp) => fp.hasCargoToml,
    entries: [
      ['run', 'cargo run'],
      ['test', 'cargo test'],
      ['build', 'cargo build'],
      ['check', 'cargo check']
    ]
  },
  {
    source: 'flutter',
    when: (fp) => fp.isFlutter,
    entries: [
      ['run', 'flutter run'],
      ['test', 'flutter test'],
      ['analyze', 'flutter analyze']
    ]
  },
  {
    source: 'dotnet',
    when: (fp) => fp.hasDotnet,
    entries: [
      ['run', 'dotnet run'],
      ['test', 'dotnet test'],
      ['build', 'dotnet build']
    ]
  },
  {
    source: 'compose',
    when: (fp) => fp.hasCompose,
    entries: [
      ['up', 'docker compose up'],
      ['up -d', 'docker compose up -d']
    ]
  }
]

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

/** 纯函数：pubspec 是否声明 flutter SDK 依赖（`sdk: flutter`）。 */
export function isFlutterPubspec(text: string): boolean {
  return /^\s*sdk:\s*flutter\s*$/m.test(text)
}

/** 纯函数：根目录文件名是否表示 .NET 工程。 */
export function isDotnetProjectFile(fileName: string): boolean {
  return fileName.endsWith('.csproj') || fileName.endsWith('.sln')
}

/** 纯函数：根目录文件名是否表示 Compose 清单。 */
export function isComposeFile(fileName: string): boolean {
  return COMPOSE_FILES.has(fileName)
}

/** 纯函数：从指纹派生约定命令条目（尚未过滤晋升）。 */
export function conventionEntries(
  fingerprints: ProjectFingerprints
): ReadonlyArray<{ source: DiscoverSource; name: string; command: string }> {
  const out: Array<{ source: DiscoverSource; name: string; command: string }> = []
  for (const group of CONVENTIONS) {
    if (!group.when(fingerprints)) continue
    for (const [name, command] of group.entries) {
      out.push({ source: group.source, name, command })
    }
  }
  return out
}

/** 约定命令：按来源 + 名查固定命令行；未命中返回 null。 */
export function conventionCommand(
  source: DiscoverSource,
  name: string,
  fingerprints: ProjectFingerprints
): string | null {
  if (source === SCRIPT_SOURCE) return null
  const hit = conventionEntries(fingerprints).find((e) => e.source === source && e.name === name)
  return hit?.command ?? null
}

/**
 * 纯函数：派生 Discovered Script —— 清单脚本 + 约定命令，去掉已晋升的 (来源, 名)。
 */
export function discoverScripts(
  projectPath: string,
  scripts: Record<string, string>,
  fingerprints: ProjectFingerprints,
  configs: RunConfig[]
): DiscoveredScript[] {
  const promoted = new Set(
    configs
      .filter(
        (c): c is Extract<RunConfig, { kind: 'referenced' }> =>
          c.kind === 'referenced' && c.projectPath === projectPath
      )
      .map((c) => discoverRefKey(c.source, c.scriptName))
  )

  const fromScripts: DiscoveredScript[] = Object.entries(scripts)
    .filter(([name]) => !promoted.has(discoverRefKey(SCRIPT_SOURCE, name)))
    .map(([name, command]) => ({
      projectPath,
      source: SCRIPT_SOURCE,
      name,
      command
    }))

  const fromConventions: DiscoveredScript[] = conventionEntries(fingerprints)
    .filter((e) => !promoted.has(discoverRefKey(e.source, e.name)))
    .map((e) => ({
      projectPath,
      source: e.source,
      name: e.name,
      command: e.command
    }))

  return [...fromScripts, ...fromConventions]
}

/**
 * 当前项目下仍存活的引用键集合。
 * `null` 表示探测快照不可用（读盘失败）——对账时应保留引用，避免原子写竞态误删。
 */
export function liveReferencedKeys(
  scripts: Record<string, string> | null,
  fingerprints: ProjectFingerprints | null
): Set<string> | null {
  if (scripts === null || fingerprints === null) return null
  const keys = new Set<string>()
  for (const name of Object.keys(scripts)) keys.add(discoverRefKey(SCRIPT_SOURCE, name))
  for (const e of conventionEntries(fingerprints)) keys.add(discoverRefKey(e.source, e.name))
  return keys
}

// —— IO 包装（依赖 fs，不依赖 electron，便于测试其纯函数） ——

export function detectPackageManager(projectPath: string): PackageManager | null {
  const present = LOCKFILE_NAMES.filter((f) => existsSync(join(projectPath, f)))
  return pickPackageManager(present)
}

export function readScripts(projectPath: string): Record<string, string> {
  const file = join(projectPath, 'package.json')
  if (!existsSync(file)) return {}
  try {
    return parseScripts(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * 对账专用：读失败返回 null（保留引用）；确认无 package.json 返回 {}。
 * 避免编辑器原子写（unlink→rename）瞬间把引用型全删掉。
 */
export function readScriptsForReconcile(projectPath: string): Record<string, string> | null {
  const file = join(projectPath, 'package.json')
  try {
    if (!existsSync(file)) {
      try {
        const names = readdirSync(projectPath)
        if (!names.includes('package.json')) return {}
        // readdir 仍见其名但 exists 为 false：极可能是原子写窗口
        return null
      } catch {
        return null
      }
    }
    return parseScripts(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function readFingerprints(projectPath: string): ProjectFingerprints {
  const fp = readFingerprintsForReconcile(projectPath)
  return (
    fp ?? {
      hasGoMod: false,
      hasCargoToml: false,
      isFlutter: false,
      hasDotnet: false,
      hasCompose: false
    }
  )
}

/** 对账专用：根目录不可读时返回 null，保留约定引用。 */
export function readFingerprintsForReconcile(projectPath: string): ProjectFingerprints | null {
  let rootFiles: string[]
  try {
    rootFiles = readdirSync(projectPath)
  } catch {
    return null
  }
  const pubspec = join(projectPath, 'pubspec.yaml')
  let isFlutter = false
  if (rootFiles.includes('pubspec.yaml')) {
    try {
      isFlutter = isFlutterPubspec(readFileSync(pubspec, 'utf8'))
    } catch {
      // pubspec 在但读失败：不当成「非 Flutter」去删约定，整份指纹标记不可用
      return null
    }
  }
  return {
    hasGoMod: rootFiles.includes('go.mod'),
    hasCargoToml: rootFiles.includes('Cargo.toml'),
    isFlutter,
    hasDotnet: rootFiles.some(isDotnetProjectFile),
    hasCompose: rootFiles.some(isComposeFile)
  }
}
