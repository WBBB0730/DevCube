import { randomUUID } from 'node:crypto'
import type { CommandRunConfig, RunConfig } from '../shared/types'
import { readScripts } from './discovery'
import { getConfigs, getProjects, setConfigs } from './store'

// —— 纯核心（供测试） ——

/** 晋升：若 (projectPath, scriptName) 尚无引用型配置，则追加一条；否则原样返回。 */
export function promote(
  configs: RunConfig[],
  projectPath: string,
  scriptName: string,
  id: string
): RunConfig[] {
  const exists = configs.some(
    (c) => c.kind === 'referenced' && c.projectPath === projectPath && c.scriptName === scriptName
  )
  if (exists) return configs
  return [...configs, { id, kind: 'referenced', projectPath, scriptName }]
}

/**
 * 对账：删除「所引用的 script 已从 package.json 消失」的引用型配置。
 * 引用型不承载自定义，直接删安全（Q13）。scriptsByProject 缺该项目时保留（项目未登记，交由 removeProject 处理）。
 */
export function reconcile(
  configs: RunConfig[],
  scriptsByProject: Map<string, Set<string>>
): RunConfig[] {
  return configs.filter((c) => {
    if (c.kind !== 'referenced') return true
    const scripts = scriptsByProject.get(c.projectPath)
    if (!scripts) return true
    return scripts.has(c.scriptName)
  })
}

// —— store 包装 ——

/** 运行一条探测脚本时调用：若尚未晋升，则创建引用型配置并落盘。 */
export function promoteScript(projectPath: string, scriptName: string): void {
  setConfigs(promote(getConfigs(), projectPath, scriptName, randomUUID()))
}

/** 依据各项目当前 package.json 的 scripts 做一次对账；有删改则落盘并返回 true。 */
export function reconcileConfigs(): boolean {
  const scriptsByProject = new Map(
    getProjects().map((p) => [p.path, new Set(Object.keys(readScripts(p.path)))] as const)
  )
  const before = getConfigs()
  const after = reconcile(before, scriptsByProject)
  if (after.length === before.length) return false
  setConfigs(after)
  return true
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
