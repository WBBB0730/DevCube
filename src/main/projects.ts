import { dialog } from 'electron'
import { mkdirSync, statSync } from 'fs'
import { basename, dirname } from 'path'
import { getAppPrefs, getProjects, setAppPrefs, setProjects } from './store'
import { headOrder } from './tree-order'

/** 记住所选项目文件夹的父目录，作为下次新建 / 添加 / 克隆项目对话框的默认位置。 */
export function rememberProjectParentDir(projectPath: string): void {
  setAppPrefs({ lastProjectParentDir: dirname(projectPath) })
}

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
    // order 取全部左树条目之前：自定义序下新项目在顶；同时写入 lastOpenedAt，打开时间序下也在顶。
    // 名称 / 添加时间升序仍由 sortTreeEntries 决定，不强制置顶。
    projects.unshift({
      path: dir,
      name: basename(dir),
      addedAt: now,
      lastOpenedAt: now,
      pinned: false,
      order: headOrder()
    })
    setProjects(projects)
  }
  return dir
}

/** 打开系统文件夹选择器并登记。用户取消返回 null。 */
export async function pickAndAddProject(): Promise<string | null> {
  const defaultPath = getAppPrefs().lastProjectParentDir
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    ...(defaultPath ? { defaultPath } : {})
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const dir = result.filePaths[0]
  rememberProjectParentDir(dir)
  return addProjectByPath(dir)
}

/**
 * 打开系统保存面板新建项目文件夹并登记（「新建项目…」）。用户取消返回 null；
 * 所填路径已存在同名目录时不删不动，直接登记（等同添加现有项目）。
 */
export async function createAndAddProject(): Promise<string | null> {
  const defaultPath = getAppPrefs().lastProjectParentDir
  const result = await dialog.showSaveDialog({
    title: '新建项目',
    buttonLabel: '创建',
    nameFieldLabel: '项目名称',
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    ...(defaultPath ? { defaultPath } : {})
  })
  if (result.canceled || result.filePath === undefined || result.filePath === '') return null
  try {
    mkdirSync(result.filePath, { recursive: true }) // 已存在同名目录时幂等
  } catch {
    return null // 创建失败（权限 / 同名文件占位等）：不登记
  }
  rememberProjectParentDir(result.filePath)
  return addProjectByPath(result.filePath)
}

/** 移除项目登记（其名下配置由调用方经 deleteConfigsOf 一并删除）。 */
export function removeProject(path: string): void {
  setProjects(getProjects().filter((p) => p.path !== path))
}

/** 记录「打开」某项目：更新 lastOpenedAt。 */
export function touchProject(path: string): void {
  const projects = getProjects()
  const i = projects.findIndex((p) => p.path === path)
  if (i < 0) return
  projects[i] = { ...projects[i], lastOpenedAt: Date.now() }
  setProjects(projects)
}
