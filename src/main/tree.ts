import type { ProjectNode } from '../shared/types'
import { detectPackageManager, discoverScripts, readScripts } from './discovery'
import { getConfigs, getProjects } from './store'

// 把持久化的 projects + configs 与实时探测组装成聚合面板的树。
export function buildTree(): ProjectNode[] {
  const configs = getConfigs()
  return getProjects().map((project) => ({
    project,
    packageManager: detectPackageManager(project.path),
    discovered: discoverScripts(project.path, readScripts(project.path), configs),
    configs: configs.filter((c) => c.projectPath === project.path)
  }))
}
