import { randomUUID } from 'node:crypto'
import { discoverRefKey } from '../shared/discover-key'
import type { DiscoverSource } from '../shared/discover-source'
import type { CommandRunConfig, RunConfig } from '../shared/types'
import {
  liveReferencedKeys,
  readFingerprintsForReconcile,
  readScriptsForReconcile
} from './discovery'
import { getConfigs, getProjects, setConfigs } from './store'

// —— 纯核心（供测试） ——

/** 晋升：若 (projectPath, source, scriptName) 尚无引用型配置，则追加一条；否则原样返回。 */
export function promote(
  configs: RunConfig[],
  projectPath: string,
  source: DiscoverSource,
  scriptName: string,
  id: string
): RunConfig[] {
  const exists = configs.some(
    (c) =>
      c.kind === 'referenced' &&
      c.projectPath === projectPath &&
      c.source === source &&
      c.scriptName === scriptName
  )
  if (exists) return configs
  return [...configs, { id, kind: 'referenced', projectPath, source, scriptName }]
}

/**
 * 对账：删除「引用键已不在存活集合」的引用型配置。
 * - alive 缺项目：保留（未登记，交由 removeProject）
 * - alive 为 null：保留（探测快照不可用，防误删）
 */
export function reconcile(
  configs: RunConfig[],
  aliveByProject: Map<string, Set<string> | null>
): RunConfig[] {
  return configs.filter((c) => {
    if (c.kind !== 'referenced') return true
    const alive = aliveByProject.get(c.projectPath)
    if (alive === undefined || alive === null) return true
    return alive.has(discoverRefKey(c.source, c.scriptName))
  })
}

// —— store 包装 ——

/** 运行 / 选中一条探测脚本时调用：若尚未晋升，则创建引用型配置并落盘。 */
export function promoteScript(
  projectPath: string,
  source: DiscoverSource,
  scriptName: string
): void {
  setConfigs(promote(getConfigs(), projectPath, source, scriptName, randomUUID()))
}

/** 依据各项目当前清单脚本与约定指纹做一次对账；落盘并返回**被删除的配置**（供调用方销毁其会话）。 */
export function reconcileConfigs(): RunConfig[] {
  const aliveByProject = new Map(
    getProjects().map((p) => {
      const scripts = readScriptsForReconcile(p.path)
      const fingerprints = readFingerprintsForReconcile(p.path)
      return [p.path, liveReferencedKeys(scripts, fingerprints)] as const
    })
  )
  const before = getConfigs()
  const after = reconcile(before, aliveByProject)
  const afterIds = new Set(after.map((c) => c.id))
  const removed = before.filter((c) => !afterIds.has(c.id))
  if (removed.length) setConfigs(after)
  return removed
}

/** 新建一条命令型配置。 */
export function createCommandConfig(input: Omit<CommandRunConfig, 'id' | 'kind'>): void {
  const config: CommandRunConfig = { ...input, id: randomUUID(), kind: 'command' }
  setConfigs([...getConfigs(), config])
}

/** 覆盖更新一条命令型配置。 */
export function updateCommandConfig(config: CommandRunConfig): void {
  setConfigs(getConfigs().map((c) => (c.id === config.id ? config : c)))
}

/** 按 id 删除任意配置（引用型删除即「取消晋升」，script 会重新回到候补区）。 */
export function deleteConfig(id: string): void {
  setConfigs(getConfigs().filter((c) => c.id !== id))
}

/** 重排某项目下的配置顺序。其它项目的配置相对顺序不变（buildTree 按项目过滤，跨项目顺序无关紧要）。 */
export function reorderConfigs(projectPath: string, orderedIds: string[]): void {
  const configs = getConfigs()
  const byId = new Map(configs.map((c) => [c.id, c]))
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((c): c is RunConfig => !!c && c.projectPath === projectPath)
  const others = configs.filter((c) => c.projectPath !== projectPath)
  setConfigs([...others, ...reordered])
}
