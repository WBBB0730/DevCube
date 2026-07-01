import { dialog } from 'electron'
import { statSync } from 'fs'
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

/** 移除项目，并连带删除其名下的所有 Run Configuration。 */
export function removeProject(path: string): void {
  setProjects(getProjects().filter((p) => p.path !== path))
  setConfigs(getConfigs().filter((c) => c.projectPath !== path))
}
