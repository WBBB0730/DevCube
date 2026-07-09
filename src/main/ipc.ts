import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { configKey } from '../shared/runnable'
import type { CommandRunConfig, ProjectSortPrefs, RunTarget } from '../shared/types'
import {
  resolveRepoSettings,
  type GitAction,
  type GitDetailsRequest,
  type GitDiffRequest,
  type GitLoadOptions,
  type GitRepoSettings,
  type GitViewPrefs
} from '../shared/git'
import {
  createCommandConfig,
  deleteConfig,
  promoteScript,
  reconcileConfigs,
  reorderConfigs,
  updateCommandConfig
} from './configs'
import {
  addProjectByPath,
  createAndAddProject,
  pickAndAddProject,
  removeProject,
  reorderProjects,
  touchProject
} from './projects'
import {
  closeSession,
  disposeSession,
  disposeTerminalsForProject,
  getSessionBuffer,
  getSessions,
  getTerminals,
  openTerminal,
  resize,
  run,
  setRunnerWindow,
  stop,
  writeStdin
} from './runner'
import {
  deleteGitSettings,
  getConfigs,
  getGitSettings,
  getGitViewPrefs,
  getProjectSortPrefs,
  getProjects,
  setGitSettings,
  setGitViewPrefs,
  setProjectSortPrefs
} from './store'
import { buildTree } from './tree'
import { syncWatchers } from './watcher'
import {
  getDetails,
  getFileDiff,
  getFileImage,
  getRepoConfig,
  getTagDetails,
  loadRepo
} from './git-data'
import { runGitAction } from './git-actions'
import { syncGitWatchers } from './git-watcher'
import { clearRepoRootCache, execGit, resolveRepoRoot, revalidateRepoRoot } from './git-exec'

let mainWindow: BrowserWindow | null = null
let registered = false

/** 主动向渲染端推送最新树（供文件监听 / 自动删除等 main 侧变更使用）。 */
export function emitTree(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.treeChanged, buildTree())
  }
}

/** 某项目的仓库内容变化（.git 变动 / git 动作完成）：通知渲染端软刷新其图谱。 */
function emitGitChanged(projectPath: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.gitChanged, projectPath)
  }
}

// git 监听集合与项目集合对齐：先解析各项目的仓库根（非仓库为 null → 探测形态 watcher）。
async function refreshGitWatchers(): Promise<void> {
  const projects = await Promise.all(
    getProjects().map(async (p) => ({
      projectPath: p.path,
      repoRoot: await resolveRepoRoot(p.path)
    }))
  )
  syncGitWatchers(projects, onGitWatcherChange)
}

// watcher 防抖回调：先重验仓库根（init / .git 删除后缓存失真），变化则对齐 watcher 形态，
// 再通知渲染端。不变时重验只多一个 rev-parse 进程（防抖收敛后频率很低）。
function onGitWatcherChange(projectPath: string): void {
  void revalidateRepoRoot(projectPath).then(async ({ changed }) => {
    if (changed) await refreshGitWatchers()
    emitGitChanged(projectPath)
  })
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

// 文件事件可能连发，防抖后先对账（删除引用悬空的配置、销毁其会话）再重建树推送。
const onWatchEvent = debounce(() => {
  for (const removed of reconcileConfigs()) disposeSession(configKey(removed))
  emitTree()
}, 120)

function refreshWatchers(): void {
  syncWatchers(
    getProjects().map((p) => p.path),
    onWatchEvent
  )
  void refreshGitWatchers()
}

export function registerIpc(win: BrowserWindow): void {
  mainWindow = win
  setRunnerWindow(win)
  if (registered) {
    refreshWatchers()
    return
  }
  registered = true
  reconcileConfigs() // 启动对账：清掉关闭期间 script 已消失的引用型配置
  refreshWatchers()

  // —— 项目 / 树 ——
  ipcMain.handle(IPC.treeGet, () => buildTree())

  ipcMain.handle(IPC.projectAdd, async () => {
    await pickAndAddProject()
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectAddByPath, (_e, path: string) => {
    addProjectByPath(path)
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectCreate, async () => {
    await createAndAddProject()
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectRemove, (_e, path: string) => {
    // 先销毁该项目名下所有会话（杀进程树 + 清状态），再移除项目。
    for (const config of getConfigs().filter((c) => c.projectPath === path)) {
      disposeSession(configKey(config))
    }
    disposeTerminalsForProject(path) // 一并杀掉并清除它名下的全部 Terminal
    removeProject(path)
    deleteGitSettings(path) // 连同它的 git 设置与仓库根缓存
    clearRepoRootCache(path)
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectReorder, (_e, orderedPaths: string[]) => {
    reorderProjects(orderedPaths)
    return buildTree()
  })

  ipcMain.handle(IPC.projectTouch, (_e, path: string) => {
    touchProject(path)
    return buildTree()
  })

  ipcMain.handle(IPC.projectSortPrefsGet, () => getProjectSortPrefs())
  ipcMain.handle(IPC.projectSortPrefsSet, (_e, patch: Partial<ProjectSortPrefs>) =>
    setProjectSortPrefs(patch)
  )

  // —— 运行时 ——
  ipcMain.handle(IPC.run, (_e, target: RunTarget) => {
    // 运行探测脚本即晋升为引用型配置：它随即从候补区移到「我的配置」。
    if (target.type === 'script') {
      promoteScript(target.projectPath, target.name)
      emitTree()
    }
    run(target)
  })
  ipcMain.handle(IPC.stop, (_e, key: string) => stop(key))
  ipcMain.on(IPC.stdin, (_e, key: string, data: string) => writeStdin(key, data))
  ipcMain.on(IPC.resize, (_e, key: string, cols: number, rows: number) => resize(key, cols, rows))
  ipcMain.handle(IPC.sessionBuffer, (_e, key: string) => getSessionBuffer(key))
  ipcMain.handle(IPC.sessions, () => getSessions())

  // —— 终端（Terminal，自由 shell）与 Tab 关闭 ——
  ipcMain.handle(IPC.terminalOpen, (_e, projectPath: string) => openTerminal(projectPath))
  // 用户关闭 Tab（Run Session / Terminal 通用）：温和停止 + 弃会话 + 通知渲染端移除 Tab。
  ipcMain.handle(IPC.sessionClose, (_e, key: string) => closeSession(key))
  ipcMain.handle(IPC.terminals, () => getTerminals())

  // 选中探测脚本即晋升为引用型配置（不必等运行；运行路径的晋升见 IPC.run）。
  ipcMain.handle(IPC.scriptPromote, (_e, projectPath: string, scriptName: string) => {
    promoteScript(projectPath, scriptName)
    return buildTree()
  })

  // —— 命令型配置 CRUD ——
  ipcMain.handle(IPC.configCreate, (_e, input: Omit<CommandRunConfig, 'id' | 'kind'>) => {
    createCommandConfig(input)
    return buildTree()
  })

  ipcMain.handle(IPC.configUpdate, (_e, config: CommandRunConfig) => {
    updateCommandConfig(config)
    return buildTree()
  })

  ipcMain.handle(IPC.configDelete, (_e, id: string) => {
    // 删除前销毁其会话（杀进程树 + 清状态）。
    const config = getConfigs().find((c) => c.id === id)
    if (config) disposeSession(configKey(config))
    deleteConfig(id)
    return buildTree()
  })

  ipcMain.handle(IPC.configReorder, (_e, projectPath: string, orderedIds: string[]) => {
    reorderConfigs(projectPath, orderedIds)
    return buildTree()
  })

  // —— 外链 ——
  // 终端/详情里点击链接 → 系统默认浏览器；放行 http/https 与 mailto（作者邮箱），杜绝 file:// 等其他协议。
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
  })
  // Git 详情面板「打开文件」→ 系统默认应用；只放行登记项目内的绝对路径。
  ipcMain.handle(IPC.openPath, (_e, path: string) => {
    if (getProjects().some((p) => path.startsWith(p.path + '/') || path === p.path)) {
      void shell.openPath(path)
    }
  })
  // 「在文件夹中显示」→ 系统文件管理器定位并选中；同样只放行登记项目内的绝对路径。
  ipcMain.handle(IPC.openInFolder, (_e, path: string) => {
    if (getProjects().some((p) => path.startsWith(p.path + '/') || path === p.path)) {
      shell.showItemInFolder(path)
    }
  })

  // —— Git 图谱 ——
  // 读操作：每项目设置在 handler 层解析成有效值传入（git-data 不依赖 store，便于测试）。
  ipcMain.handle(IPC.gitLoad, (_e, projectPath: string, options: GitLoadOptions) =>
    loadRepo(projectPath, options, resolveRepoSettings(getGitSettings(projectPath)))
  )
  ipcMain.handle(IPC.gitDetails, (_e, projectPath: string, request: GitDetailsRequest) =>
    getDetails(projectPath, request, true)
  )
  ipcMain.handle(IPC.gitFileDiff, (_e, projectPath: string, request: GitDiffRequest) =>
    getFileDiff(projectPath, request)
  )
  ipcMain.handle(IPC.gitFileImage, (_e, projectPath: string, request: GitDiffRequest) =>
    getFileImage(projectPath, request)
  )
  ipcMain.handle(IPC.gitTagDetails, (_e, projectPath: string, tagName: string) =>
    getTagDetails(projectPath, tagName)
  )
  ipcMain.handle(IPC.gitRepoConfig, (_e, projectPath: string) => getRepoConfig(projectPath))
  // 写操作：单通道判别联合。完成后无论成败都推 git:changed（部分成功也要刷新）；
  // opts.silent 时跳过——渲染端自刷新的静默动作（暂存/提交/撤销）避免并发 load 竞态。
  ipcMain.handle(
    IPC.gitAction,
    async (_e, projectPath: string, action: GitAction, opts?: { silent?: boolean }) => {
      const result = await runGitAction(projectPath, action)
      if (action.kind === 'init') {
        // init 会改变仓库根（非仓库 → 仓库）：显式重验 + 对齐 watcher 形态。不能依赖探测
        // watcher 的事件——动作执行期间（含余震窗口）watcher 静音，事件会被丢弃
        await revalidateRepoRoot(projectPath)
        await refreshGitWatchers()
      }
      if (opts?.silent !== true) emitGitChanged(projectPath)
      return result
    }
  )
  // 重验仓库根（Git Tab 变为可见 / 非仓库态点刷新）：变化则对齐 watcher 并推 git:changed
  ipcMain.handle(IPC.gitRevalidate, async (_e, projectPath: string) => {
    const { changed } = await revalidateRepoRoot(projectPath)
    if (changed) {
      await refreshGitWatchers()
      emitGitChanged(projectPath)
    }
    return changed
  })
  // 当前生效的 init.defaultBranch（初始化对话框预填）：未配置回落 'main'
  ipcMain.handle(IPC.gitDefaultBranch, async (_e, projectPath: string) => {
    const result = await execGit(projectPath, ['config', '--get', 'init.defaultBranch'])
    const value = result.code === 0 ? result.stdout.toString('utf8').trim() : ''
    return value === '' ? 'main' : value
  })
  // 设置与视图偏好：写返回权威快照。
  ipcMain.handle(IPC.gitSettingsGet, (_e, projectPath: string) => getGitSettings(projectPath))
  ipcMain.handle(IPC.gitSettingsSet, (_e, projectPath: string, patch: Partial<GitRepoSettings>) =>
    setGitSettings(projectPath, patch)
  )
  ipcMain.handle(IPC.gitViewPrefsGet, () => getGitViewPrefs())
  ipcMain.handle(IPC.gitViewPrefsSet, (_e, patch: Partial<GitViewPrefs>) => setGitViewPrefs(patch))
}
