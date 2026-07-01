import type { ProjectNode } from '../shared/types'
import { getConfigs, getProjects } from './store'

// 把持久化的 projects + configs 组装成聚合面板的树。
// packageManager 与 discovered 在 slice 2（探测）接入，这里先给空。
export function buildTree(): ProjectNode[] {
  const configs = getConfigs()
  return getProjects().map((project) => ({
    project,
    packageManager: null,
    discovered: [],
    configs: configs.filter((c) => c.projectPath === project.path)
  }))
}
