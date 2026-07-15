import { dialog } from 'electron'
import { mkdirSync, statSync } from 'fs'
import { basename } from 'path'
import { getConfigs, getProjects, setConfigs, setProjects } from './store'
import type { Project } from '../shared/types'

/** 按绝对路径去重登记一个项目；已存在则原样返回该路径。非目录返回 null。 */
export function addProjectByPath(dir: string): string | null {
  try {
    if (!statSync(dir).isDirectory()) return null
  } catch {
    return null
  }
  const projects = getProjects()
  if (!projects.some((p) => p.path === dir)) {
    const now = Date.now()
    // 插到数组头：自定义序下新项目在顶；同时写入 lastOpenedAt，打开时间序下也在顶。
    // 名称 / 添加时间升序仍由 sortProjectNodes 决定，不强制置顶。
    projects.unshift({
      path: dir,
      name: basename(dir),
      addedAt: now,
      lastOpenedAt: now
    })
    setProjects(projects)
  }
  return dir
}

/** 打开系统文件夹选择器并登记。用户取消返回 null。 */
export async function pickAndAddProject(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return addProjectByPath(result.filePaths[0])
}

/**
 * 打开系统保存面板新建项目文件夹并登记（「新建项目…」）。用户取消返回 null；
 * 所填路径已存在同名目录时不删不动，直接登记（等同添加现有项目）。
 */
export async function createAndAddProject(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '新建项目',
    buttonLabel: '创建',
    nameFieldLabel: '项目名称',
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || result.filePath === undefined || result.filePath === '') return null
  try {
    mkdirSync(result.filePath, { recursive: true }) // 已存在同名目录时幂等
  } catch {
    return null // 创建失败（权限 / 同名文件占位等）：不登记
  }
  return addProjectByPath(result.filePath)
}

/** 移除项目，并连带删除其名下的所有 Run Configuration。 */
export function removeProject(path: string): void {
  setProjects(getProjects().filter((p) => p.path !== path))
  setConfigs(getConfigs().filter((c) => c.projectPath !== path))
}

/** 重排项目列表顺序。严格按 orderedPaths；未知路径丢弃，未列出的追加末尾。 */
export function reorderProjects(orderedPaths: string[]): void {
  const byPath = new Map(getProjects().map((p) => [p.path, p]))
  const seen = new Set<string>()
  const reordered: Project[] = []
  for (const path of orderedPaths) {
    const p = byPath.get(path)
    if (!p || seen.has(path)) continue
    seen.add(path)
    reordered.push(p)
  }
  for (const p of byPath.values()) {
    if (!seen.has(p.path)) reordered.push(p)
  }
  setProjects(reordered)
}

/** 记录「打开」某项目：更新 lastOpenedAt。 */
export function touchProject(path: string): void {
  const projects = getProjects()
  const i = projects.findIndex((p) => p.path === path)
  if (i < 0) return
  projects[i] = { ...projects[i], lastOpenedAt: Date.now() }
  setProjects(projects)
}
