import { dialog } from 'electron'
import { mkdirSync, statSync } from 'fs'
import { basename } from 'path'
import { getConfigs, getProjects, setConfigs, setProjects } from './store'

/** 按绝对路径去重登记一个项目；非目录（如误拖入文件）直接忽略。 */
export function addProjectByPath(dir: string): void {
  try {
    if (!statSync(dir).isDirectory()) return
  } catch {
    return
  }
  const projects = getProjects()
  if (projects.some((p) => p.path === dir)) return
  projects.push({ path: dir, name: basename(dir) })
  setProjects(projects)
}

/** 打开系统文件夹选择器并登记。用户取消则不变。 */
export async function pickAndAddProject(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return
  addProjectByPath(result.filePaths[0])
}

/**
 * 打开系统保存面板新建项目文件夹并登记（「新建项目…」）。用户取消则不变；
 * 所填路径已存在同名目录时不删不动，直接登记（等同添加现有项目）。
 */
export async function createAndAddProject(): Promise<void> {
  const result = await dialog.showSaveDialog({
    title: '新建项目',
    buttonLabel: '创建',
    nameFieldLabel: '项目名称',
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || result.filePath === undefined || result.filePath === '') return
  try {
    mkdirSync(result.filePath, { recursive: true }) // 已存在同名目录时幂等
  } catch {
    return // 创建失败（权限 / 同名文件占位等）：不登记
  }
  addProjectByPath(result.filePath)
}

/** 移除项目，并连带删除其名下的所有 Run Configuration。 */
export function removeProject(path: string): void {
  setProjects(getProjects().filter((p) => p.path !== path))
  setConfigs(getConfigs().filter((c) => c.projectPath !== path))
}
