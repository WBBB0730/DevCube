/**
 * 更新重启后重新运行（docs/prd/in-app-update.md）：点「立即更新」退出前记下运行中的配置，新版本启动后问一次要不要
 * 重新运行。只含 Project 与 Server 上的配置：数据源上的是一段 SQL，再执行一遍可能重复写数据。
 */

import { configKey } from './runnable'
import type { ServerNode } from './server'
import type { ProjectNode, RunConfig } from './types'

/** 要重新运行的一条配置：id、会话键与显示名。 */
export type RunToRerun = { id: string; key: string; name: string }

/** 一个条目（Project / Server）下要重新运行的配置。 */
export type RerunGroup = { entryName: string; runs: RunToRerun[] }

/** 记下的配置里现在还在的，按条目分组：Project 在前、Server 在后，组内按配置的顺序；数据源上的不在其中。 */
export function runsToRerun(
  ids: readonly string[],
  tree: readonly ProjectNode[],
  servers: readonly ServerNode[]
): RerunGroup[] {
  const wanted = new Set(ids)
  const group = (entryName: string, configs: readonly RunConfig[]): RerunGroup[] => {
    const runs = configs
      .filter((c) => wanted.has(c.id))
      .map((c) => ({
        id: c.id,
        key: configKey(c),
        name: c.kind === 'referenced' ? c.scriptName : c.name
      }))
    return runs.length === 0 ? [] : [{ entryName, runs }]
  }
  return [
    ...tree.flatMap((n) => group(n.project.name, n.configs)),
    ...servers.flatMap((n) => group(n.server.name, n.configs))
  ]
}

/**
 * 确认框的问句与说明：标题一条时点名、多条时报数（同撤销更改、删除文件）；说明不分条数，一句话下每个条目一行
 * （`条目名：配置名、配置名`）。
 */
export function rerunPrompt(groups: readonly RerunGroup[]): { title: string; message: string } {
  const runs = groups.flatMap((g) => g.runs)
  const lines = groups.map((g) => `${g.entryName}：${g.runs.map((r) => r.name).join('、')}`)
  return {
    title: runs.length === 1 ? `重新运行 “${runs[0]!.name}”？` : `重新运行 ${runs.length} 个配置？`,
    message: ['以下配置更新前正在运行。', ...lines].join('\n')
  }
}
