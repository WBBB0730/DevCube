import { getConfigs, getProjects } from './store'
import { detectPackageManager, discoverScripts, readFingerprints, readScripts } from './discovery'
import type { ProjectNode } from '../shared/types'

/**
 * 项目 → 主工作树目录（仅链接工作树非 null）。buildTree 是同步的、不能跑 git，所以由
 * ipc 的监听对齐（那里本就为每个项目解析 gitdir）在解析后写入，变化时再推一次树。
 */
const worktreeOfByProject = new Map<string, string | null>()

/** 写入某项目的主工作树目录；返回是否与之前不同（调用方据此决定要不要重推树）。 */
export function setProjectWorktreeOf(projectPath: string, mainPath: string | null): boolean {
  const prev = worktreeOfByProject.get(projectPath) ?? null
  worktreeOfByProject.set(projectPath, mainPath)
  return prev !== mainPath
}

export function clearProjectWorktreeOf(projectPath: string): void {
  worktreeOfByProject.delete(projectPath)
}

// 把持久化的 projects + configs 与实时探测组装成聚合面板的树。
export function buildTree(): ProjectNode[] {
  const configs = getConfigs()
  return getProjects().map((project) => ({
    project,
    packageManager: detectPackageManager(project.path),
    discovered: discoverScripts(
      project.path,
      readScripts(project.path),
      readFingerprints(project.path),
      configs
    ),
    configs: configs.filter((c) => c.projectPath === project.path),
    worktreeOf: worktreeOfByProject.get(project.path) ?? null
  }))
}
