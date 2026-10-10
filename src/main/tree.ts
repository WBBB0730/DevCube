import { getConfigs, getProjects } from './store'
import { discoverScripts, NO_FINGERPRINTS } from './discovery'
import { projectDiscovery } from './wsl-discovery'
import { configOwnerKey } from '../shared/tree-entry'
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

// 把持久化的 projects + configs 与实时探测组装成聚合面板的树（WSL 项目的探测只读缓存，从未连上时没有检测结果）。
export function buildTree(): ProjectNode[] {
  const configs = getConfigs()
  return getProjects().map((project) => {
    const snapshot = projectDiscovery(project.path)
    return {
      project,
      packageManager: snapshot?.packageManager ?? null,
      discovered:
        snapshot === null
          ? []
          : discoverScripts(
              project.path,
              snapshot.scripts ?? {},
              snapshot.fingerprints ?? NO_FINGERPRINTS,
              configs
            ),
      configs: configs.filter((c) => configOwnerKey(c) === project.path),
      worktreeOf: worktreeOfByProject.get(project.path) ?? null
    }
  })
}
