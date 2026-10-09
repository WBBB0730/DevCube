import { app, ipcMain, BrowserWindow, clipboard, shell } from 'electron'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { IPC } from '../shared/ipc'
import { configKey, residentDataSourceTabKey } from '../shared/runnable'
import { isOpenInAppId } from '../shared/open-in-app'
import { isSystemIntegrationFeatureId } from '../shared/system-integration'
import { isExternalLink } from '../shared/external-link'
import { applySystemIntegration, getSystemIntegrationState } from './system-integration'
import type { DiscoverSource } from '../shared/discover-source'
import type {
  AppPrefs,
  EditableRunConfig,
  EditableRunConfigInput,
  ProjectCloneResult,
  ProjectSortPrefs,
  RunTarget,
  ServerAddResult,
  TreeSnapshot,
  WindowsShellOption
} from '../shared/types'
import type { CatalogPath } from '../shared/data-source-catalog'
import type { DataSourceOpened, DataSourceTabUi } from '../shared/data-source-ui'
import type { RunParams } from '../shared/run-params'
import type { ConsoleContextChange } from '../shared/data-source-context'
import type {
  CompletionUsage,
  ExportResult,
  ResultSet,
  TableExportRequest,
  TablePageRequest,
  TableRef
} from '../shared/data-source-query'
import { exportFileName, type ExportFormat } from '../shared/data-source-export'
import { exportResultRows } from './data-source-export'
import {
  dataSourceConnectionChanged,
  type DataSourceAddResult,
  type DataSourceConnectPassword,
  type DataSourceInput,
  type DataSourceTestInput,
  type SqlKind
} from '../shared/data-source'
import { serverConnectionChanged, type ServerInput, type ServerTestInput } from '../shared/server'
import type { SshPromptResponse } from '../shared/ssh-connect'
import type { TransferConflictResponse } from '../shared/server-files'
import { dataSourceEntryKey, serverEntryKey } from '../shared/tree-entry'
import { resolveClonePath, type GitCloneInput } from '../shared/git-clone'
import { listOpenInApps, openInApp } from './open-in-app'
import {
  resolveRepoSettings,
  type GitAction,
  type GitDetailsRequest,
  type GitDiffRequest,
  type GitLoadOptions,
  type GitRepoSettings,
  type GitViewPrefs
} from '../shared/git'
import { cwdFromPickedDir, findGitBash, resolveCwd } from './command'
import {
  createCommandConfig,
  deleteConfig,
  deleteConfigsOf,
  promoteScript,
  reconcileConfigs,
  reorderConfigs,
  saveRunParams,
  updateCommandConfig
} from './configs'
import { pickDirectory, pickFile, pickPaths, pickSavePath } from './dialogs'
import { respondSshPrompt, setSshPromptSink } from './ssh-prompts'
import { passwordUnavailableReason } from './secrets'
import {
  addDataSource,
  dropDataSourceRecent,
  findDataSource,
  forgetDataSourcePlaces,
  listDataSourceNodes,
  pushDataSourceRecent,
  removeDataSource,
  saveDataSourceCompletionUsage,
  setDataSourceShownDatabases,
  touchDataSource,
  updateDataSource
} from './data-sources'
import { cancelDataSourceTest, testDataSourceConnection } from './data-source-connect'
import { getDataSourceRunOutput } from './data-source-runs'
import {
  cancelDataSourceConsole,
  cancelDataSourceTableCount,
  closeDataSourceSession,
  connectDataSourceSession,
  connectSqliteFileSession,
  countDataSourceTableRows,
  disconnectDataSourceSession,
  disposeDataSourceSessions,
  exportDataSourceTable,
  getDataSourceConsoleContext,
  getDataSourceSession,
  hasRedisKey,
  peekDataSourceCatalog,
  peekDataSourceCatalogLayers,
  peekDataSourceCompletionSchema,
  peekDataSourceDatabases,
  peekDataSourceObjectDetail,
  readDataSourceCatalog,
  readDataSourceCompletionFor,
  readDataSourceCompletionSchema,
  readDataSourceObjectDetail,
  readDataSourceTablePage,
  readRedisCommands,
  readRedisDatabases,
  readRedisKey,
  reopenDataSourceSession,
  resetDataSourceSessions,
  runDataSourceConsole,
  runRedisCommands,
  scanRedisKeys,
  setDataSourceSessionSink,
  switchDataSourceConsoleContext,
  updateDataSourceSessionsPassword,
  updateDataSourceSessionsShown
} from './data-source-sessions'
import {
  addServers,
  cancelServerTest,
  findServer,
  listServerNodes,
  listSshConfigHosts,
  removeServer,
  testServerConnection,
  touchServer,
  updateServer
} from './servers'
import { reorderEntries, setEntryPinned } from './tree-order'
import {
  connectServerStatus,
  disconnectServerStatus,
  disposeServerStatus,
  getServerStatus,
  resetServerStatus,
  setServerStatusSink
} from './server-status'
import {
  cancelServerFileRead,
  cancelServerTransfer,
  connectServerFiles,
  createServerEntry,
  deleteServerEntry,
  disconnectServerFiles,
  disposeServerFiles,
  dismissServerTransfer,
  downloadFromServer,
  getServerFilesState,
  getServerTransfers,
  listServerDir,
  readServerFile,
  renameServerEntry,
  resetServerFiles,
  respondTransferConflict,
  setServerFilesSink,
  setUnsavedServerFileCount,
  statServerPath,
  uploadToServer,
  writeServerFile
} from './server-files'
import { cancelClone, checkCloneTarget, runClone } from './git-clone'
import {
  addProjectByPath,
  createAndAddProject,
  pickAndAddProject,
  rememberProjectParentDir,
  removeProject,
  touchProject
} from './projects'
import {
  closeSession,
  disposeSession,
  disposeSshTerminalsForServer,
  disposeTerminalsForEntry,
  clearSessionOutput,
  getSessionBuffer,
  getSessions,
  getTerminals,
  openSshTerminal,
  openTerminal,
  resize,
  run,
  setRunnerWindow,
  stop,
  writeStdin
} from './runner'
import {
  deleteFilesUi,
  deleteGitSettings,
  deleteDataSourceTabState,
  deleteTerminalShells,
  getDataSourceCompletionUsage,
  getDataSourceConsole,
  getDataSourceRecents,
  getDataSourceTabUi,
  deleteWorkspaceUiForEntry,
  getConfigs,
  getRunParams,
  getFilesUi,
  getGitSettings,
  getGitViewPrefs,
  getAppPrefs,
  getProjectSortPrefs,
  getProjects,
  getWorkspaceUi,
  setDataSourceConsole,
  setDataSourceTabUi,
  setAppPrefs,
  setFilesUi,
  setGitSettings,
  setGitViewPrefs,
  setProjectSortPrefs,
  setWorkspaceUi
} from './store'
import { applyTheme } from './theme'
import {
  assertFilesRoot,
  createEntry,
  filesSysPath,
  filterFilesTreeQuery,
  imagePreviewEntry,
  imagePyramidEntry,
  listDir,
  readFileEntry,
  readHeadText,
  renameEntry,
  sanitizeFilesUi,
  trashEntry,
  writeFileEntry
} from './files'
import { invalidateFilesIndex } from './files-index'
import { startContentSearch, stopContentSearch } from './content-search'
import type { ContentSearchOptions } from '../shared/content-search'
import type { FilesUiState } from '../shared/files'
import type { WorkspaceUiState } from '../shared/workspace'
import { buildTree, clearProjectWorktreeOf, setProjectWorktreeOf } from './tree'
import { isAppQuitting } from './app-shutdown'
import {
  getDetails,
  getFileDiff,
  getFileImage,
  getRepoConfig,
  getTagDetails,
  loadRepo
} from './git-data'
import { runGitAction } from './git-actions'
import { syncProjectWatchers } from './project-watchers'
import {
  clearRepoRootCache,
  execGit,
  mainWorktreePathOf,
  resolveGitDirs,
  resolveRepoRoot,
  revalidateRepoRoot
} from './git-exec'
import {
  checkAppUpdates,
  getAppUpdateState,
  getDevChangelogPreview,
  performUpdateButtonAction,
  startAppUpdater
} from './app-updater'
import { confirmQuitIfNeeded } from './quit-confirm'
import { markQuitAllowed } from './app-shutdown'
import { isPathUnderGrantedRoot } from './files-roots'
import { openPreviewWindowForRoot, setPreviewWindowRoot } from './preview-window'
import {
  cancelCompress,
  compressTargetExists,
  openCompressWindow,
  scanForCompress,
  startCompress
} from './compress'
import { normalizeCompressOptions } from '../shared/compress'
import { copyFileToClipboard } from './clipboard-file'
import { setTerminalFocused } from './app-shortcuts'
import { broadcast } from './app-window'

let mainWindow: BrowserWindow | null = null
/** 没有主窗口时（只开着预览窗口 / macOS 全关）由 index 提供建窗；工作台已预置当前项目 */
let mainWindowFactory: (() => BrowserWindow) | null = null

function liveMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * 关掉 Data Source Tab（用户关 Tab、所在项目被移除）：断开并忘掉连接，删掉控制台里写的内容与记住的界面状态（此后渲染端
 * 卸载控制台时晚到的写入不再收，见 deleteDataSourceTabState）。
 */
function closeDataSourceTabs(tabKeys: string[]): void {
  for (const tabKey of tabKeys) closeDataSourceSession(tabKey)
  deleteDataSourceTabState(tabKeys)
}

/** 连到数据源 id 的各个 Data Source Tab 的键：常驻的与另开的（含开在项目里的）。 */
function dataSourceTabKeys(id: string): string[] {
  const opened = Object.values(getWorkspaceUi().terminalsByEntry)
    .flat()
    .filter((shell) => shell.dataSourceId === id)
    .map((shell) => shell.id)
  return [residentDataSourceTabKey(dataSourceEntryKey(id)), ...opened]
}

/** 主动向渲染端推送最新树（供文件监听 / 自动删除等 main 侧变更使用）。 */
export function emitTree(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.treeChanged, buildTree())
  }
}

/** 左树三类条目的全量快照（跨类的改动一并返回）。 */
function treeSnapshot(): TreeSnapshot {
  return { tree: buildTree(), servers: listServerNodes(), dataSources: listDataSourceNodes() }
}

/** 某项目的仓库内容变化（.git 变动 / git 动作完成）：通知渲染端软刷新其图谱。 */
function emitGitChanged(projectPath: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.gitChanged, projectPath)
  }
}

/** 某项目工作区文件变化：作废文件名索引，并通知 Files Tab 重拉已缓存目录 / 同步打开文件。 */
function emitFilesChanged(projectPath: string): void {
  invalidateFilesIndex(projectPath)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.filesChanged, projectPath)
  }
}

/**
 * External Open（运行中）：登记（或命中已登记）后对齐 watcher，并推送渲染端选中。
 * 主窗口不存在时把当前项目预置进工作台再建窗（bootstrap 快照直接带出选中，不依赖事后推送）。
 * 返回该路径是否在调用前就已登记。
 */
export function openProjectFromExternal(path: string): { registered: boolean } {
  const registered = getProjects().some((p) => p.path === path)
  const focusPath = addProjectByPath(path)
  if (focusPath === null) return { registered }
  refreshWatchers()
  const win = liveMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(IPC.projectExternalOpen, focusPath)
  } else if (mainWindowFactory) {
    setWorkspaceUi({ ...getWorkspaceUi(), currentEntryKey: focusPath, selectedKey: null })
    mainWindowFactory()
  }
  return { registered }
}

// 每项目一条原生递归监听：解析仓库根后对齐（非仓库 repoRoot=null → 探测 .git 出现）。
async function refreshProjectWatchers(): Promise<void> {
  if (isAppQuitting()) return
  const projects = await Promise.all(
    getProjects().map(async (p) => {
      const repoRoot = await resolveRepoRoot(p.path)
      return {
        projectPath: p.path,
        repoRoot,
        // 链接工作树要额外盯主仓库的公共 gitdir（refs / 各工作树 HEAD），形态由 watcher 侧判断
        gitDirs: repoRoot === null ? null : await resolveGitDirs(repoRoot)
      }
    })
  )
  syncProjectWatchers(projects, {
    onDiscoveryChange: onDiscoveryWatchEvent,
    onFilesChange: emitFilesChanged,
    onGitChange: onGitWatcherChange
  })
  // 左树的工作树角标：buildTree 同步、不能跑 git，gitdir 在这里已解析好，顺手写入；变了才重推树
  let worktreeOfChanged = false
  for (const p of projects) {
    const mainPath = p.gitDirs === null ? null : mainWorktreePathOf(p.gitDirs)
    if (setProjectWorktreeOf(p.projectPath, mainPath)) worktreeOfChanged = true
  }
  if (worktreeOfChanged) emitTree()
}

// watcher 防抖回调：先重验仓库根（init / .git 删除后缓存失真），变化则对齐 watcher 形态，
// 再通知渲染端。不变时重验只多一个 rev-parse 进程（防抖收敛后频率很低）。
function onGitWatcherChange(projectPath: string): void {
  void revalidateRepoRoot(projectPath).then(async ({ changed }) => {
    if (changed) await refreshProjectWatchers()
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

// 清单 / lockfile 事件可能连发，防抖后先对账再重建树推送。
const onDiscoveryWatchEvent = debounce(() => {
  for (const removed of reconcileConfigs()) disposeSession(configKey(removed))
  emitTree()
}, 120)

function refreshWatchers(): void {
  void refreshProjectWatchers()
}

/** 主窗口建成后绑定：运行器输出、更新推送、树推送都只面向主窗口；预览窗口不在此列。 */
export function bindMainWindow(win: BrowserWindow): void {
  mainWindow = win
  setRunnerWindow(win)
  startAppUpdater()
  refreshWatchers()
}

/**
 * 注册全部 IPC handler（进程内一次，须早于任何窗口——冷启动可能只开预览窗口而无主窗口）。
 * `createMainWindow` 供 External Open / 「添加为项目」在没有主窗口时拉起。
 */
export function registerIpcHandlers(createMainWindow: () => BrowserWindow): void {
  mainWindowFactory = createMainWindow
  reconcileConfigs() // 启动对账：清掉关闭期间 script 已消失的引用型配置
  refreshWatchers()

  // —— 项目 / 树 ——
  ipcMain.handle(IPC.treeGet, () => buildTree())

  ipcMain.handle(IPC.projectAdd, async () => {
    const focusPath = await pickAndAddProject()
    refreshWatchers()
    return { tree: buildTree(), focusPath }
  })

  ipcMain.handle(IPC.projectAddByPath, (_e, path: string) => {
    const focusPath = addProjectByPath(path)
    refreshWatchers()
    return { tree: buildTree(), focusPath }
  })

  ipcMain.handle(IPC.projectCreate, async () => {
    const focusPath = await createAndAddProject()
    refreshWatchers()
    return { tree: buildTree(), focusPath }
  })

  ipcMain.handle(
    IPC.projectClone,
    async (_e, input: GitCloneInput): Promise<ProjectCloneResult> => {
      const outcome = await runClone(input, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.projectCloneProgress, progress)
        }
      })
      if (outcome.status !== 'ok') return outcome
      // 克隆成功：与其余三条登记路径同一收口（登记 + 对齐监听 + 记住父目录）
      const focusPath = addProjectByPath(outcome.path)
      if (focusPath === null) return { status: 'error', message: '克隆完成，但目录无法登记为项目' }
      rememberProjectParentDir(outcome.path)
      refreshWatchers()
      return { status: 'ok', tree: buildTree(), focusPath }
    }
  )

  ipcMain.handle(IPC.projectCloneCancel, () => cancelClone())

  ipcMain.handle(IPC.projectCloneCheckTarget, (_e, parentDir: string, name: string) =>
    checkCloneTarget(resolveClonePath(parentDir, name))
  )

  ipcMain.handle(IPC.projectRemove, (_e, path: string) => {
    // 先删掉该项目名下的配置并销毁其会话（杀进程树 + 清状态），再移除项目。
    for (const config of deleteConfigsOf(path)) disposeSession(configKey(config))
    disposeTerminalsForEntry(path) // 一并杀掉并清除它名下的全部 Terminal / SSH Terminal
    // 开在它里面的 Data Source Tab 一并关掉（壳随下面清工作台现场时删掉）
    closeDataSourceTabs(
      (getWorkspaceUi().terminalsByEntry[path] ?? [])
        .filter((shell) => shell.dataSourceId !== undefined)
        .map((shell) => shell.id)
    )
    removeProject(path)
    deleteGitSettings(path) // 连同它的 git 设置与仓库根缓存
    deleteFilesUi(path)
    deleteWorkspaceUiForEntry(path)
    clearRepoRootCache(path)
    clearProjectWorktreeOf(path)
    refreshWatchers()
    return buildTree()
  })

  ipcMain.handle(IPC.projectTouch, (_e, path: string) => {
    touchProject(path)
    return buildTree()
  })

  // —— 左树条目（Project、Server 与 Data Source 混排） ——
  ipcMain.handle(IPC.entryReorder, (_e, orderedKeys: string[]): TreeSnapshot => {
    reorderEntries(orderedKeys)
    return treeSnapshot()
  })

  ipcMain.handle(IPC.entrySetPinned, (_e, key: string, pinned: boolean): TreeSnapshot => {
    setEntryPinned(key, pinned)
    return treeSnapshot()
  })

  // —— 数据源（Data Source，ADR-0043） ——
  ipcMain.handle(IPC.dataSourcesGet, () => listDataSourceNodes())
  ipcMain.handle(IPC.dataSourceAdd, (_e, input: DataSourceInput): DataSourceAddResult => ({
    focusId: addDataSource(input),
    dataSources: listDataSourceNodes()
  }))
  ipcMain.handle(IPC.dataSourceUpdate, (_e, id: string, input: DataSourceInput) => {
    const before = findDataSource(id)
    updateDataSource(id, input)
    // 连接信息变了：它的各个 Tab 断开，回到未连接（运行会话的连接不断开，这一次照旧跑完），表结构缓存删掉；连到的
    // 可能已是别的库，显示的库回到默认，最近打开与各 Tab 记住的对象、目录展开、控制台上下文一并忘掉。只改名、改记住的密码不断开；换了密码时之后另开的连接用新密码
    if (before !== null && dataSourceConnectionChanged(before.target, input.target)) {
      resetDataSourceSessions(id)
      forgetDataSourcePlaces(id, dataSourceTabKeys(id))
    } else if (typeof input.password === 'string') {
      updateDataSourceSessionsPassword(id, input.password)
    }
    return listDataSourceNodes()
  })
  ipcMain.handle(IPC.dataSourceRemove, (_e, id: string) => {
    // 先删掉它名下的配置并销毁其运行会话，断开并忘掉连到它的各个 Tab（含开在项目里的）、删掉表结构缓存，
    // 再删它们的控制台内容与记住的界面状态、清工作台现场、删登记与记住的密码、最近打开、补全的使用次数
    for (const config of deleteConfigsOf(dataSourceEntryKey(id))) disposeSession(configKey(config))
    disposeDataSourceSessions(id)
    deleteDataSourceTabState(dataSourceTabKeys(id))
    deleteWorkspaceUiForEntry(dataSourceEntryKey(id))
    deleteTerminalShells((shell) => shell.dataSourceId === id)
    removeDataSource(id)
    return listDataSourceNodes()
  })
  ipcMain.handle(IPC.dataSourceTouch, (_e, id: string) => {
    touchDataSource(id)
    return listDataSourceNodes()
  })
  // 目录根行勾选显示的库：按数据源记（它的各个 Tab 一样）；连着的各个 Tab 在后台把新勾上的库读一遍
  ipcMain.handle(IPC.dataSourceShownDatabasesSet, (_e, id: string, databases: string[]) => {
    const before = findDataSource(id)?.shownDatabases
    setDataSourceShownDatabases(id, databases)
    updateDataSourceSessionsShown(id, before)
    return listDataSourceNodes()
  })
  ipcMain.handle(IPC.dataSourcePickSqliteFile, () => pickFile(undefined, mainWindow))
  ipcMain.handle(IPC.dataSourceTest, (_e, input: DataSourceTestInput) =>
    testDataSourceConnection(input)
  )
  ipcMain.handle(IPC.dataSourceTestCancel, () => cancelDataSourceTest())
  ipcMain.handle(IPC.dataSourceSessionGet, (_e, tabKey: string) => getDataSourceSession(tabKey))
  ipcMain.handle(
    IPC.dataSourceSessionConnect,
    (_e, tabKey: string, dataSourceId: string, password: DataSourceConnectPassword | null) =>
      connectDataSourceSession(tabKey, dataSourceId, password)
  )
  ipcMain.handle(IPC.dataSourceSessionDisconnect, (_e, tabKey: string) =>
    disconnectDataSourceSession(tabKey)
  )
  ipcMain.handle(IPC.dataSourceTabClose, (_e, tabKey: string) => closeDataSourceTabs([tabKey]))
  ipcMain.handle(IPC.dataSourceConsoleRun, (_e, tabKey: string, statements: string[]) =>
    runDataSourceConsole(tabKey, statements)
  )
  ipcMain.handle(IPC.dataSourceConsoleCancel, (_e, tabKey: string) =>
    cancelDataSourceConsole(tabKey)
  )
  ipcMain.handle(IPC.dataSourceCompletion, (_e, tabKey: string, database?: string) =>
    readDataSourceCompletionSchema(tabKey, database)
  )
  ipcMain.handle(IPC.dataSourceCompletionPeek, (_e, tabKey: string, database?: string) =>
    peekDataSourceCompletionSchema(tabKey, database)
  )
  ipcMain.handle(IPC.dataSourceCompletionUsageGet, (_e, id: string) =>
    getDataSourceCompletionUsage(id)
  )
  ipcMain.handle(IPC.dataSourceCompletionUsageSet, (_e, id: string, usage: CompletionUsage) =>
    saveDataSourceCompletionUsage(id, usage)
  )
  ipcMain.handle(IPC.dataSourceConsoleContextGet, (_e, tabKey: string) =>
    getDataSourceConsoleContext(tabKey)
  )
  ipcMain.handle(
    IPC.dataSourceConsoleContextSwitch,
    (_e, tabKey: string, change: ConsoleContextChange) =>
      switchDataSourceConsoleContext(tabKey, change)
  )
  // 运行配置对话框：「库」的选项与补全都先取表结构缓存，不依赖 Tab
  ipcMain.handle(IPC.dataSourceDatabasesPeek, (_e, id: string) => peekDataSourceDatabases(id))
  ipcMain.handle(IPC.dataSourceCompletionFor, (_e, id: string, database: string) =>
    readDataSourceCompletionFor(id, database)
  )
  ipcMain.handle(IPC.dataSourceConsoleTextGet, (_e, tabKey: string) => getDataSourceConsole(tabKey))
  ipcMain.handle(IPC.dataSourceConsoleTextSet, (_e, tabKey: string, text: string) =>
    setDataSourceConsole(tabKey, text)
  )
  ipcMain.handle(IPC.dataSourceTabUiGet, (_e, tabKey: string) => getDataSourceTabUi(tabKey))
  ipcMain.handle(IPC.dataSourceTabUiSet, (_e, tabKey: string, patch: Partial<DataSourceTabUi>) =>
    setDataSourceTabUi(tabKey, patch)
  )
  ipcMain.handle(IPC.dataSourceRecentsGet, (_e, id: string) => getDataSourceRecents(id))
  ipcMain.handle(IPC.dataSourceRecentPush, (_e, id: string, opened: DataSourceOpened) =>
    pushDataSourceRecent(id, opened)
  )
  ipcMain.handle(IPC.dataSourceRecentDrop, (_e, id: string, opened: DataSourceOpened) =>
    dropDataSourceRecent(id, opened)
  )
  // 导出分两步：先在下载目录弹保存对话框（挂在发起导出的窗口上，主窗口或 Preview Window），选好了渲染端才开始导出
  // （导出钮转圈）并交来文件写入；取消即不导出。默认文件名由表名处理成单个合法文件名
  ipcMain.handle(
    IPC.dataSourcePickExportFile,
    (e, fileName: string, format: ExportFormat): Promise<string | null> =>
      pickSavePath(
        join(app.getPath('downloads'), exportFileName(fileName, format)),
        BrowserWindow.fromWebContents(e.sender)
      )
  )
  ipcMain.handle(
    IPC.dataSourceExportTable,
    (
      _e,
      tabKey: string,
      request: TableExportRequest,
      format: ExportFormat,
      file: string
    ): Promise<ExportResult> => exportDataSourceTable(tabKey, request, format, file)
  )
  ipcMain.handle(
    IPC.dataSourceExportRows,
    (_e, kind: SqlKind, result: ResultSet, format: ExportFormat, file: string) =>
      exportResultRows(kind, result, format, file)
  )
  ipcMain.handle(IPC.dataSourceCatalog, (_e, tabKey: string, path: CatalogPath) =>
    readDataSourceCatalog(tabKey, path)
  )
  // 取表结构缓存（不访问数据库）：界面先显示它，同时照常现查
  ipcMain.handle(IPC.dataSourceCatalogPeek, (_e, tabKey: string, path: CatalogPath) =>
    peekDataSourceCatalog(tabKey, path)
  )
  // 目录各层的表结构缓存（不访问数据库）与批量读取还在不在进行：目录按名称筛选时连同已读取的层一起找
  ipcMain.handle(IPC.dataSourceCatalogLayersPeek, (_e, tabKey: string) =>
    peekDataSourceCatalogLayers(tabKey)
  )
  ipcMain.handle(IPC.dataSourceTablePage, (_e, tabKey: string, request: TablePageRequest) =>
    readDataSourceTablePage(tabKey, request)
  )
  ipcMain.handle(IPC.dataSourceTableCount, (_e, tabKey: string, table: TableRef, where: string) =>
    countDataSourceTableRows(tabKey, table, where)
  )
  ipcMain.handle(IPC.dataSourceTableCountCancel, (_e, tabKey: string) =>
    cancelDataSourceTableCount(tabKey)
  )
  ipcMain.handle(
    IPC.dataSourceObjectDetail,
    (_e, tabKey: string, path: CatalogPath, name: string, detail?: string) =>
      readDataSourceObjectDetail(tabKey, path, name, detail)
  )
  ipcMain.handle(
    IPC.dataSourceObjectDetailPeek,
    (_e, tabKey: string, path: CatalogPath, name: string, detail?: string) =>
      peekDataSourceObjectDetail(tabKey, path, name, detail)
  )
  ipcMain.handle(IPC.redisScanKeys, (_e, tabKey: string, pattern: string) =>
    scanRedisKeys(tabKey, pattern)
  )
  ipcMain.handle(IPC.redisReadKey, (_e, tabKey: string, key: string) => readRedisKey(tabKey, key))
  ipcMain.handle(IPC.redisHasKey, (_e, tabKey: string, key: string) => hasRedisKey(tabKey, key))
  ipcMain.handle(IPC.redisRunCommands, (_e, tabKey: string, lines: string[]) =>
    runRedisCommands(tabKey, lines)
  )
  ipcMain.handle(IPC.redisDatabases, (_e, tabKey: string) => readRedisDatabases(tabKey))
  ipcMain.handle(IPC.redisCommands, (_e, tabKey: string) => readRedisCommands(tabKey))
  ipcMain.handle(IPC.dataSourceSessionReopen, (_e, tabKey: string) =>
    reopenDataSourceSession(tabKey)
  )
  // 会话记住发起打开的页面：它关闭、重载时一并关掉；路径越界等打不开的原因显示在面板里
  ipcMain.handle(
    IPC.dataSourceSqliteFileOpen,
    (e, tabKey: string, rootPath: string, filePath: string) =>
      connectSqliteFileSession(e.sender, tabKey, () => filesSysPath(rootPath, filePath))
  )
  // 它不保存控制台内容，关掉只断开连接（不走关 Data Source Tab 的收尾）
  ipcMain.handle(IPC.dataSourceSqliteFileClose, (_e, tabKey: string) =>
    closeDataSourceSession(tabKey)
  )
  setDataSourceSessionSink({
    // Preview Window 里也能直接打开 SQLite 文件：连接状态推给所有窗口，各窗口按 Tab 键认领
    state: (event) => broadcast(IPC.dataSourceSessionChanged, event),
    dataSourcesChanged: () =>
      liveMainWindow()?.webContents.send(IPC.dataSourcesChanged, listDataSourceNodes()),
    context: (event) => broadcast(IPC.dataSourceConsoleContextChanged, event),
    // 补全的计数器在主窗口里（登记的数据源只在主窗口打开），只推给它，免得各窗口重复计数
    executed: (event) => liveMainWindow()?.webContents.send(IPC.dataSourceExecuted, event),
    // 同连接状态：Preview Window 里直接打开的 SQLite 文件也有目录筛选
    catalogLayers: (event) => broadcast(IPC.dataSourceCatalogLayersChanged, event)
  })

  // —— 服务器（Server，ADR-0038） ——
  ipcMain.handle(IPC.serversGet, () => listServerNodes())
  ipcMain.handle(IPC.serverSshConfigHosts, () => listSshConfigHosts())
  ipcMain.handle(IPC.serverAdd, (_e, inputs: ServerInput[]): ServerAddResult => {
    const focusIds = addServers(inputs)
    return { servers: listServerNodes(), focusIds }
  })
  ipcMain.handle(IPC.serverUpdate, (_e, id: string, input: ServerInput) => {
    const before = findServer(id)
    updateServer(id, input)
    // 连接信息变了：文件与状态连接断开，回到未连接（只改名、改记住的密码不断开）
    if (before !== null && serverConnectionChanged(before, input)) {
      resetServerFiles(id)
      resetServerStatus(id)
    }
    return listServerNodes()
  })
  ipcMain.handle(IPC.serverRemove, (_e, id: string) => {
    // 先删掉它名下的配置并销毁其运行会话、关掉连到它的 SSH Terminal（含开在项目里的），
    // 再清工作台现场、删登记与记住的密码
    for (const config of deleteConfigsOf(serverEntryKey(id))) disposeSession(configKey(config))
    disposeSshTerminalsForServer(id)
    disposeServerStatus(id)
    disposeServerFiles(id)
    deleteFilesUi(serverEntryKey(id))
    deleteWorkspaceUiForEntry(serverEntryKey(id))
    deleteTerminalShells((shell) => shell.serverId === id)
    removeServer(id)
    return listServerNodes()
  })
  ipcMain.handle(IPC.serverTouch, (_e, id: string) => {
    touchServer(id)
    return listServerNodes()
  })
  ipcMain.handle(IPC.serverPickIdentityFile, () => pickFile(join(homedir(), '.ssh'), mainWindow))
  ipcMain.handle(IPC.serverTest, (_e, input: ServerTestInput) => testServerConnection(input))
  ipcMain.handle(IPC.serverTestCancel, () => cancelServerTest())
  ipcMain.handle(IPC.serverStatusGet, (_e, serverId: string) => getServerStatus(serverId))
  ipcMain.handle(IPC.serverStatusConnect, (_e, serverId: string) => connectServerStatus(serverId))
  ipcMain.handle(IPC.serverStatusDisconnect, (_e, serverId: string) =>
    disconnectServerStatus(serverId)
  )
  setServerStatusSink((event) => liveMainWindow()?.webContents.send(IPC.serverStatusChanged, event))

  // —— 服务器文件（Server 的 Files Tab，ADR-0041） ——
  ipcMain.handle(IPC.serverFilesGet, (_e, serverId: string) => getServerFilesState(serverId))
  ipcMain.handle(IPC.serverFilesConnect, (_e, serverId: string) => connectServerFiles(serverId))
  ipcMain.handle(IPC.serverFilesDisconnect, (_e, serverId: string) =>
    disconnectServerFiles(serverId)
  )
  ipcMain.handle(IPC.serverFilesListDir, (_e, serverId: string, dir: string) =>
    listServerDir(serverId, dir)
  )
  ipcMain.handle(IPC.serverFilesStat, (_e, serverId: string, path: string) =>
    statServerPath(serverId, path)
  )
  ipcMain.handle(IPC.serverFilesRead, (_e, serverId: string, path: string, force: boolean) =>
    readServerFile(serverId, path, force)
  )
  ipcMain.handle(IPC.serverFilesReadCancel, (_e, serverId: string) =>
    cancelServerFileRead(serverId)
  )
  ipcMain.handle(
    IPC.serverFilesWrite,
    (
      _e,
      serverId: string,
      path: string,
      content: string,
      base: { mtimeMs: number; size: number }
    ) => writeServerFile(serverId, path, content, base)
  )
  ipcMain.handle(
    IPC.serverFilesCreate,
    (_e, serverId: string, dir: string, name: string, kind: 'file' | 'directory') =>
      createServerEntry(serverId, dir, name, kind)
  )
  ipcMain.handle(IPC.serverFilesRename, (_e, serverId: string, path: string, newName: string) =>
    renameServerEntry(serverId, path, newName)
  )
  ipcMain.handle(IPC.serverFilesDelete, (_e, serverId: string, path: string) =>
    deleteServerEntry(serverId, path)
  )
  // 服务器的 Files UI 按条目键记；不在这里剔除失效路径（要连上才查得了），打开失败时渲染端自行剔除
  ipcMain.handle(IPC.serverFilesGetUi, (_e, serverId: string) =>
    getFilesUi(serverEntryKey(serverId))
  )
  ipcMain.handle(IPC.serverFilesSetUi, (_e, serverId: string, patch: Partial<FilesUiState>) =>
    setFilesUi(serverEntryKey(serverId), patch)
  )
  ipcMain.handle(
    IPC.serverFilesUpload,
    (_e, serverId: string, remoteDir: string, localPaths: string[]) =>
      uploadToServer(serverId, localPaths, remoteDir)
  )
  ipcMain.handle(
    IPC.serverFilesUploadPick,
    async (_e, serverId: string, remoteDir: string, kind: 'file' | 'directory') => {
      const picked = await pickPaths(
        [kind === 'file' ? 'openFile' : 'openDirectory', 'multiSelections'],
        undefined,
        mainWindow
      )
      uploadToServer(serverId, picked, remoteDir)
    }
  )
  // 下载：文件弹保存对话框（同名由系统问），文件夹选目标目录；默认都在系统「下载」文件夹
  ipcMain.handle(
    IPC.serverFilesDownload,
    async (_e, serverId: string, remotePath: string, isDirectory: boolean) => {
      const downloads = app.getPath('downloads')
      const target = isDirectory
        ? await pickDirectory(downloads, mainWindow)
        : await pickSavePath(join(downloads, posix.basename(remotePath)), mainWindow)
      if (target !== null) downloadFromServer(serverId, remotePath, isDirectory, target)
    }
  )
  ipcMain.handle(IPC.serverTransfersGet, (_e, serverId: string) => getServerTransfers(serverId))
  ipcMain.handle(IPC.serverTransferCancel, (_e, serverId: string, id: string) =>
    cancelServerTransfer(serverId, id)
  )
  ipcMain.handle(IPC.serverTransferDismiss, (_e, serverId: string, id: string) =>
    dismissServerTransfer(serverId, id)
  )
  ipcMain.on(IPC.transferConflictRespond, (_e, response: TransferConflictResponse) =>
    respondTransferConflict(response)
  )
  ipcMain.on(IPC.serverFilesUnsavedCount, (_e, count: number) => setUnsavedServerFileCount(count))
  setServerFilesSink({
    state: (event) => liveMainWindow()?.webContents.send(IPC.serverFilesStateChanged, event),
    transfers: (event) => liveMainWindow()?.webContents.send(IPC.serverTransfersChanged, event),
    readProgress: (event) => liveMainWindow()?.webContents.send(IPC.serverFilesReadProgress, event),
    entriesChanged: (serverId) =>
      liveMainWindow()?.webContents.send(IPC.serverFilesEntriesChanged, serverId),
    conflict: (request) => {
      const win = liveMainWindow()
      // 没有主窗口就没人能回答：按跳过处理
      if (win) win.webContents.send(IPC.transferConflictRequest, request)
      else respondTransferConflict({ id: request.id, action: 'skip', applyToRest: false })
    },
    conflictDismiss: (id) => liveMainWindow()?.webContents.send(IPC.transferConflictDismiss, id)
  })
  ipcMain.on(IPC.sshPromptRespond, (_e, response: SshPromptResponse) => respondSshPrompt(response))
  setSshPromptSink({
    request: (request) => {
      const win = liveMainWindow()
      // 没有主窗口就没人能回答：按取消处理
      if (win) win.webContents.send(IPC.sshPromptRequest, request)
      else respondSshPrompt({ id: request.id, answers: null, remember: false })
    },
    dismiss: (id) => liveMainWindow()?.webContents.send(IPC.sshPromptDismiss, id),
    passwordSaved: () => liveMainWindow()?.webContents.send(IPC.serversChanged, listServerNodes())
  })

  ipcMain.handle(IPC.projectSortPrefsGet, () => getProjectSortPrefs())
  ipcMain.handle(IPC.projectSortPrefsSet, (_e, patch: Partial<ProjectSortPrefs>) =>
    setProjectSortPrefs(patch)
  )

  ipcMain.handle(IPC.passwordUnavailableReason, () => passwordUnavailableReason())
  ipcMain.handle(IPC.appPrefsGet, () => getAppPrefs())
  ipcMain.handle(IPC.appPrefsSet, (_e, patch: Partial<AppPrefs>) => {
    const merged = setAppPrefs(patch)
    // 主题改动即时落到原生侧（themeSource 驱动渲染层 prefers-color-scheme，无需重启窗口）。
    if (patch.theme !== undefined) applyTheme(merged.theme)
    // 推给全部窗口：主窗口与 Preview Window 的设置弹窗都能改，JS 侧读的偏好（自动获取）各窗口同步
    broadcast(IPC.appPrefsChanged, merged)
    return merged
  })
  ipcMain.handle(IPC.pickDirectory, (_e, defaultPath?: string) =>
    pickDirectory(defaultPath, mainWindow)
  )
  ipcMain.handle(IPC.clipboardReadText, () => clipboard.readText())
  ipcMain.handle(IPC.windowsShellOptions, (): WindowsShellOption[] => [
    { id: 'git-bash', available: findGitBash() !== null },
    { id: 'powershell', available: true },
    { id: 'cmd', available: true }
  ])

  // —— 运行时 ——
  ipcMain.handle(IPC.run, (_e, target: RunTarget) => {
    // 运行探测脚本即晋升为引用型配置：它随即从候补区移到「我的配置」。
    if (target.type === 'script') {
      promoteScript(target.projectPath, target.source, target.name)
      emitTree()
    }
    return run(target)
  })
  ipcMain.handle(IPC.stop, (_e, key: string) => stop(key))
  ipcMain.on(IPC.stdin, (_e, key: string, data: string) => writeStdin(key, data))
  ipcMain.on(IPC.resize, (_e, key: string, cols: number, rows: number) => resize(key, cols, rows))
  ipcMain.handle(IPC.sessionBuffer, (_e, key: string) => getSessionBuffer(key))
  ipcMain.handle(IPC.sessionClear, (_e, key: string) => clearSessionOutput(key))
  ipcMain.handle(IPC.sessions, () => getSessions())
  ipcMain.handle(IPC.dataSourceRunOutputGet, (_e, key: string) => getDataSourceRunOutput(key))
  ipcMain.handle(IPC.runParamsGet, (_e, configId: string) => getRunParams(configId))
  ipcMain.handle(IPC.runParamsSet, (_e, configId: string, params: RunParams) =>
    saveRunParams(configId, params)
  )

  // —— 终端（Terminal，自由 shell）与 Tab 关闭 ——
  ipcMain.handle(IPC.terminalOpen, (_e, projectPath: string, key?: string, cwd?: string) =>
    openTerminal(projectPath, key, cwd)
  )
  ipcMain.handle(
    IPC.sshTerminalOpen,
    (_e, ownerKey: string, serverId: string, key?: string, cwd?: string) =>
      openSshTerminal(ownerKey, serverId, key, cwd)
  )
  // 用户关闭 Tab（Run Session / Terminal 通用）：温和停止 + 弃会话 + 通知渲染端移除 Tab。
  ipcMain.handle(IPC.sessionClose, (_e, key: string) => closeSession(key))
  ipcMain.handle(IPC.terminals, () => getTerminals())
  // 焦点进出终端：应用快捷键据此让出与 shell 冲突的键（见 app-shortcuts / ADR-0013）。
  ipcMain.on(IPC.terminalFocus, (e, focused: boolean) => setTerminalFocused(e.sender, focused))

  // —— 工作台 UI（ADR-0008） ——
  ipcMain.handle(IPC.workspaceUiGet, () => getWorkspaceUi())
  ipcMain.handle(IPC.workspaceUiSet, (_e, state: WorkspaceUiState) => setWorkspaceUi(state))

  // 选中探测脚本即晋升为引用型配置（不必等运行；运行路径的晋升见 IPC.run）。
  ipcMain.handle(
    IPC.scriptPromote,
    (_e, projectPath: string, source: DiscoverSource, scriptName: string) => {
      promoteScript(projectPath, source, scriptName)
      return buildTree()
    }
  )

  // —— 命令型配置 CRUD（本机、服务器上或数据源上；返回三类条目的快照） ——
  ipcMain.handle(IPC.configCreate, (_e, input: EditableRunConfigInput): TreeSnapshot => {
    createCommandConfig(input)
    return treeSnapshot()
  })

  ipcMain.handle(IPC.configUpdate, (_e, config: EditableRunConfig): TreeSnapshot => {
    updateCommandConfig(config)
    return treeSnapshot()
  })

  ipcMain.handle(IPC.configDelete, (_e, id: string): TreeSnapshot => {
    // 删除前销毁其会话（杀进程树 + 清状态）。
    const config = getConfigs().find((c) => c.id === id)
    if (config) disposeSession(configKey(config))
    deleteConfig(id)
    return treeSnapshot()
  })

  ipcMain.handle(IPC.configReorder, (_e, ownerKey: string, orderedIds: string[]): TreeSnapshot => {
    reorderConfigs(ownerKey, orderedIds)
    return treeSnapshot()
  })

  ipcMain.handle(IPC.configPickCwd, async (_e, projectPath: unknown, currentCwd: unknown) => {
    if (typeof projectPath !== 'string') return null
    if (!getProjects().some((p) => p.path === projectPath)) return null
    const cwd = typeof currentCwd === 'string' && currentCwd !== '' ? currentCwd : undefined
    const picked = await pickDirectory(resolveCwd(projectPath, cwd), mainWindow)
    if (!picked) return null
    return cwdFromPickedDir(projectPath, picked)
  })

  // —— 外链 ——
  // 终端/详情/预览里点击链接 → 系统默认浏览器；白名单 isExternalLink 与开窗守卫同一份。
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (isExternalLink(url)) shell.openExternal(url)
  })
  // Git 详情面板「打开文件」→ 系统默认应用；只放行授权根（登记项目 / 预览窗口根）内的绝对路径。
  ipcMain.handle(IPC.openPath, (_e, path: string) => {
    if (isPathUnderGrantedRoot(path)) void shell.openPath(path)
  })
  // 「在文件夹中显示」→ 系统文件管理器定位并选中；同样只放行授权根内的绝对路径。
  ipcMain.handle(IPC.openInFolder, (_e, path: string) => {
    if (isPathUnderGrantedRoot(path)) shell.showItemInFolder(path)
  })
  // 「复制文件」→ 文件 / 文件夹本身进系统剪贴板；同样只放行授权根内的绝对路径。
  ipcMain.handle(IPC.filesCopyFile, async (_e, path: string) => {
    if (isPathUnderGrantedRoot(path)) await copyFileToClipboard(path)
  })
  // 「压缩」→ 为该条目开一个压缩窗口；同样只放行授权根内的绝对路径。
  ipcMain.handle(IPC.filesCompress, async (_e, path: string) => {
    if (isPathUnderGrantedRoot(path)) await openCompressWindow([path])
  })
  // —— Preview Window（预览窗口） ——
  ipcMain.handle(IPC.previewSetRoot, (e, root: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win || typeof root !== 'string') return false
    return setPreviewWindowRoot(win, root)
  })
  ipcMain.handle(IPC.previewAddProject, (_e, root: unknown) => {
    if (typeof root !== 'string') return { registered: false }
    return openProjectFromExternal(root)
  })
  ipcMain.handle(IPC.previewOpenRoot, (_e, projectPath: unknown) => {
    if (typeof projectPath !== 'string') return
    if (!getProjects().some((p) => p.path === projectPath)) return
    openPreviewWindowForRoot(projectPath)
  })
  // —— 压缩窗口（docs/prd/compress.md）：会话按发起请求的窗口取 ——
  ipcMain.handle(IPC.compressScan, (e, options: unknown) =>
    scanForCompress(e.sender, normalizeCompressOptions(options))
  )
  ipcMain.handle(IPC.compressTargetExists, (_e, dir: unknown, name: unknown) =>
    typeof dir === 'string' && typeof name === 'string' ? compressTargetExists(dir, name) : false
  )
  ipcMain.handle(IPC.compressPickDir, (e, defaultPath: unknown) =>
    pickDirectory(
      typeof defaultPath === 'string' ? defaultPath : undefined,
      BrowserWindow.fromWebContents(e.sender)
    )
  )
  ipcMain.handle(
    IPC.compressStart,
    (e, request: { dir?: unknown; name?: unknown; options?: unknown }) => {
      if (typeof request?.dir !== 'string' || typeof request.name !== 'string') {
        return { status: 'error' as const, message: '无效参数' }
      }
      return startCompress(e.sender, {
        dir: request.dir,
        name: request.name,
        options: normalizeCompressOptions(request.options)
      })
    }
  )
  ipcMain.handle(IPC.compressCancel, (e) => cancelCompress(e.sender))
  // —— 系统集成（设置「系统集成」栏；状态实时探测不落盘） ——
  ipcMain.handle(IPC.integrationGet, () => getSystemIntegrationState())
  ipcMain.handle(IPC.integrationApply, async (_e, id: unknown, enable: unknown) => {
    if (!isSystemIntegrationFeatureId(id) || typeof enable !== 'boolean') {
      return { ok: false as const, error: '无效参数', state: await getSystemIntegrationState() }
    }
    return applySystemIntegration(id, enable)
  })

  // 项目「打开于」：探测已装桌面工具；打开仅放行已登记项目根。
  ipcMain.handle(IPC.openInAppList, () => listOpenInApps())
  ipcMain.handle(IPC.openInApp, (_e, id: unknown, projectPath: unknown) => {
    if (!isOpenInAppId(id) || typeof projectPath !== 'string') {
      return { ok: false as const, error: '无效参数' }
    }
    if (!getProjects().some((p) => p.path === projectPath)) {
      return { ok: false as const, error: '项目未登记' }
    }
    return openInApp(id, projectPath)
  })

  // —— Files Tab ——
  ipcMain.handle(IPC.filesListDir, (_e, projectPath: string, dirPath: string) =>
    listDir(projectPath, dirPath)
  )
  ipcMain.handle(IPC.filesFilterTree, (_e, projectPath: string, query: string) =>
    filterFilesTreeQuery(projectPath, query)
  )
  ipcMain.handle(IPC.filesRead, (_e, projectPath: string, filePath: string) =>
    readFileEntry(projectPath, filePath)
  )
  ipcMain.handle(IPC.filesWrite, (_e, projectPath: string, filePath: string, content: string) =>
    writeFileEntry(projectPath, filePath, content)
  )
  ipcMain.handle(IPC.filesHeadText, (_e, projectPath: string, filePath: string) =>
    readHeadText(projectPath, filePath)
  )
  ipcMain.handle(IPC.filesImagePreview, (_e, projectPath: string, filePath: string) =>
    imagePreviewEntry(projectPath, filePath)
  )
  ipcMain.handle(IPC.filesImagePyramid, (_e, projectPath: string, filePath: string) =>
    imagePyramidEntry(projectPath, filePath)
  )
  ipcMain.handle(
    IPC.filesCreate,
    (_e, projectPath: string, dirPath: string, name: string, kind: 'file' | 'directory') =>
      createEntry(projectPath, dirPath, name, kind)
  )
  ipcMain.handle(IPC.filesRename, (_e, projectPath: string, entryPath: string, newName: string) =>
    renameEntry(projectPath, entryPath, newName)
  )
  ipcMain.handle(IPC.filesTrash, (_e, projectPath: string, entryPath: string) =>
    trashEntry(projectPath, entryPath)
  )

  // —— 内容搜索（Content Search） ——
  ipcMain.handle(
    IPC.contentSearchStart,
    (_e, projectPath: string, query: string, options: ContentSearchOptions, seq: number) => {
      startContentSearch(assertFilesRoot(projectPath), query, options, seq, (ev) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.contentSearchEvent, ev)
        }
      })
    }
  )
  ipcMain.handle(IPC.contentSearchStop, () => stopContentSearch())
  ipcMain.handle(IPC.filesGetUi, async (_e, projectPath: string) => {
    const ui = getFilesUi(projectPath)
    const sanitized = await sanitizeFilesUi(projectPath, ui)
    if (
      sanitized.openPath !== ui.openPath ||
      sanitized.recentPaths.length !== ui.recentPaths.length ||
      sanitized.recentPaths.some((p, i) => p !== ui.recentPaths[i])
    ) {
      setFilesUi(projectPath, {
        openPath: sanitized.openPath,
        recentPaths: sanitized.recentPaths
      })
    }
    return sanitized
  })
  ipcMain.handle(IPC.filesSetUi, (_e, projectPath: string, patch: Partial<FilesUiState>) =>
    setFilesUi(projectPath, patch)
  )

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
        // init 会改变仓库根（非仓库 → 仓库）：显式重验 + 对齐 watcher 形态。不等探测
        // watcher 的事件——动作执行期间（含余震窗口）它挂起，转闲才补发，界面会慢一拍
        await revalidateRepoRoot(projectPath)
        await refreshProjectWatchers()
      }
      if (opts?.silent !== true) emitGitChanged(projectPath)
      return result
    }
  )
  // 重验仓库根（Git Tab 变为可见 / 非仓库态点刷新）：变化则对齐 watcher 并推 git:changed
  ipcMain.handle(IPC.gitRevalidate, async (_e, projectPath: string) => {
    const { changed } = await revalidateRepoRoot(projectPath)
    if (changed) {
      await refreshProjectWatchers()
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

  // —— 应用内更新 ——
  ipcMain.handle(IPC.appUpdateGet, () => getAppUpdateState())
  ipcMain.handle(IPC.appUpdateCheck, (_e, force?: boolean) =>
    checkAppUpdates({ force: force === true })
  )
  ipcMain.handle(IPC.appUpdatePerform, async () => {
    const state = getAppUpdateState()
    if (!state.showButton) return { startedInstall: false }
    if (state.buttonAction === 'quitAndInstall') {
      const ok = await confirmQuitIfNeeded(mainWindow)
      if (!ok) return { startedInstall: false }
      markQuitAllowed()
    }
    return performUpdateButtonAction()
  })
  // 本地预览只在未包装开发里有意义（打包产物不带 CHANGELOG.md），打包后不注册
  if (!app.isPackaged) ipcMain.handle(IPC.appUpdateDevPreview, () => getDevChangelogPreview())
}
