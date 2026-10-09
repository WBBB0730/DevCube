import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { RendererBootstrap } from '../shared/renderer-bootstrap'
import type { RunAPI, RunTarget } from '../shared/types'
import type { GitAction, GitDetailsRequest, GitDiffRequest, GitLoadOptions } from '../shared/git'

function subscribe<T>(channel: string, cb: (arg: T) => void): () => void {
  const listener = (_e: unknown, arg: T): void => cb(arg)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// 在页面脚本跑之前同步取快照，首帧 zustand 即可有树/工作台。
const bootstrap = ipcRenderer.sendSync(IPC.bootstrapSync) as RendererBootstrap

const api: RunAPI = {
  getBootstrap: () => bootstrap,
  getTree: () => ipcRenderer.invoke(IPC.treeGet),
  addProject: () => ipcRenderer.invoke(IPC.projectAdd),
  addProjectByPath: (path) => ipcRenderer.invoke(IPC.projectAddByPath, path),
  createProject: () => ipcRenderer.invoke(IPC.projectCreate),
  cloneProject: (input) => ipcRenderer.invoke(IPC.projectClone, input),
  cancelProjectClone: () => ipcRenderer.invoke(IPC.projectCloneCancel),
  checkCloneTarget: (parentDir, name) =>
    ipcRenderer.invoke(IPC.projectCloneCheckTarget, parentDir, name),
  onProjectCloneProgress: (cb) => subscribe(IPC.projectCloneProgress, cb),
  removeProject: (path) => ipcRenderer.invoke(IPC.projectRemove, path),
  reorderEntries: (orderedKeys) => ipcRenderer.invoke(IPC.entryReorder, orderedKeys),
  touchProject: (path) => ipcRenderer.invoke(IPC.projectTouch, path),
  setEntryPinned: (key, pinned) => ipcRenderer.invoke(IPC.entrySetPinned, key, pinned),
  getProjectSortPrefs: () => ipcRenderer.invoke(IPC.projectSortPrefsGet),
  setProjectSortPrefs: (patch) => ipcRenderer.invoke(IPC.projectSortPrefsSet, patch),
  getAppPrefs: () => ipcRenderer.invoke(IPC.appPrefsGet),
  setAppPrefs: (patch) => ipcRenderer.invoke(IPC.appPrefsSet, patch),
  onAppPrefsChanged: (cb) => subscribe(IPC.appPrefsChanged, cb),
  setPanelSizes: (patch) => ipcRenderer.invoke(IPC.panelSizesSet, patch),
  onPanelSizesChanged: (cb) => subscribe(IPC.panelSizesChanged, cb),
  resetLayout: () => ipcRenderer.invoke(IPC.layoutReset),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(IPC.pickDirectory, defaultPath),
  readClipboardText: () => ipcRenderer.invoke(IPC.clipboardReadText),
  getWindowsShellOptions: () => ipcRenderer.invoke(IPC.windowsShellOptions),
  getPasswordUnavailableReason: () => ipcRenderer.invoke(IPC.passwordUnavailableReason),

  getDataSources: () => ipcRenderer.invoke(IPC.dataSourcesGet),
  onDataSourcesChanged: (cb) => subscribe(IPC.dataSourcesChanged, cb),
  addDataSource: (input) => ipcRenderer.invoke(IPC.dataSourceAdd, input),
  updateDataSource: (id, input) => ipcRenderer.invoke(IPC.dataSourceUpdate, id, input),
  removeDataSource: (id) => ipcRenderer.invoke(IPC.dataSourceRemove, id),
  touchDataSource: (id) => ipcRenderer.invoke(IPC.dataSourceTouch, id),
  setDataSourceShownDatabases: (id, databases) =>
    ipcRenderer.invoke(IPC.dataSourceShownDatabasesSet, id, databases),
  pickSqliteFile: () => ipcRenderer.invoke(IPC.dataSourcePickSqliteFile),
  testDataSourceConnection: (input) => ipcRenderer.invoke(IPC.dataSourceTest, input),
  cancelDataSourceTest: () => ipcRenderer.invoke(IPC.dataSourceTestCancel),
  getDataSourceSession: (tabKey) => ipcRenderer.invoke(IPC.dataSourceSessionGet, tabKey),
  connectDataSourceSession: (tabKey, dataSourceId, password) =>
    ipcRenderer.invoke(IPC.dataSourceSessionConnect, tabKey, dataSourceId, password),
  disconnectDataSourceSession: (tabKey) =>
    ipcRenderer.invoke(IPC.dataSourceSessionDisconnect, tabKey),
  closeDataSourceTab: (tabKey) => ipcRenderer.invoke(IPC.dataSourceTabClose, tabKey),
  onDataSourceSessionChanged: (cb) => subscribe(IPC.dataSourceSessionChanged, cb),
  reopenDataSourceSession: (tabKey) => ipcRenderer.invoke(IPC.dataSourceSessionReopen, tabKey),
  openSqliteFileSession: (tabKey, rootPath, filePath) =>
    ipcRenderer.invoke(IPC.dataSourceSqliteFileOpen, tabKey, rootPath, filePath),
  closeSqliteFileSession: (tabKey) => ipcRenderer.invoke(IPC.dataSourceSqliteFileClose, tabKey),
  readDataSourceCatalog: (tabKey, path) => ipcRenderer.invoke(IPC.dataSourceCatalog, tabKey, path),
  peekDataSourceCatalog: (tabKey, path) =>
    ipcRenderer.invoke(IPC.dataSourceCatalogPeek, tabKey, path),
  peekDataSourceCatalogLayers: (tabKey) =>
    ipcRenderer.invoke(IPC.dataSourceCatalogLayersPeek, tabKey),
  onDataSourceCatalogLayersChanged: (cb) => subscribe(IPC.dataSourceCatalogLayersChanged, cb),
  readDataSourceTablePage: (tabKey, request) =>
    ipcRenderer.invoke(IPC.dataSourceTablePage, tabKey, request),
  countDataSourceTableRows: (tabKey, table, where) =>
    ipcRenderer.invoke(IPC.dataSourceTableCount, tabKey, table, where),
  cancelDataSourceTableCount: (tabKey) =>
    ipcRenderer.invoke(IPC.dataSourceTableCountCancel, tabKey),
  readDataSourceObjectDetail: (tabKey, path, name, detail) =>
    ipcRenderer.invoke(IPC.dataSourceObjectDetail, tabKey, path, name, detail),
  peekDataSourceObjectDetail: (tabKey, path, name, detail) =>
    ipcRenderer.invoke(IPC.dataSourceObjectDetailPeek, tabKey, path, name, detail),
  runDataSourceConsole: (tabKey, statements) =>
    ipcRenderer.invoke(IPC.dataSourceConsoleRun, tabKey, statements),
  cancelDataSourceConsole: (tabKey) => ipcRenderer.invoke(IPC.dataSourceConsoleCancel, tabKey),
  onDataSourceExecuted: (cb) => subscribe(IPC.dataSourceExecuted, cb),
  readDataSourceCompletionSchema: (tabKey, database) =>
    ipcRenderer.invoke(IPC.dataSourceCompletion, tabKey, database),
  peekDataSourceCompletionSchema: (tabKey, database) =>
    ipcRenderer.invoke(IPC.dataSourceCompletionPeek, tabKey, database),
  getDataSourceCompletionUsage: (dataSourceId) =>
    ipcRenderer.invoke(IPC.dataSourceCompletionUsageGet, dataSourceId),
  setDataSourceCompletionUsage: (dataSourceId, usage) =>
    ipcRenderer.invoke(IPC.dataSourceCompletionUsageSet, dataSourceId, usage),
  getDataSourceConsoleContext: (tabKey) =>
    ipcRenderer.invoke(IPC.dataSourceConsoleContextGet, tabKey),
  onDataSourceConsoleContextChanged: (cb) => subscribe(IPC.dataSourceConsoleContextChanged, cb),
  switchDataSourceConsoleContext: (tabKey, change) =>
    ipcRenderer.invoke(IPC.dataSourceConsoleContextSwitch, tabKey, change),
  peekDataSourceDatabases: (dataSourceId) =>
    ipcRenderer.invoke(IPC.dataSourceDatabasesPeek, dataSourceId),
  readDataSourceCompletionFor: (dataSourceId, database) =>
    ipcRenderer.invoke(IPC.dataSourceCompletionFor, dataSourceId, database),
  getDataSourceConsoleText: (tabKey) => ipcRenderer.invoke(IPC.dataSourceConsoleTextGet, tabKey),
  setDataSourceConsoleText: (tabKey, text) =>
    ipcRenderer.invoke(IPC.dataSourceConsoleTextSet, tabKey, text),
  getDataSourceTabUi: (tabKey) => ipcRenderer.invoke(IPC.dataSourceTabUiGet, tabKey),
  setDataSourceTabUi: (tabKey, patch) => ipcRenderer.invoke(IPC.dataSourceTabUiSet, tabKey, patch),
  getDataSourceRecents: (dataSourceId) =>
    ipcRenderer.invoke(IPC.dataSourceRecentsGet, dataSourceId),
  pushDataSourceRecent: (dataSourceId, opened) =>
    ipcRenderer.invoke(IPC.dataSourceRecentPush, dataSourceId, opened),
  dropDataSourceRecent: (dataSourceId, opened) =>
    ipcRenderer.invoke(IPC.dataSourceRecentDrop, dataSourceId, opened),
  scanRedisKeys: (tabKey, pattern) => ipcRenderer.invoke(IPC.redisScanKeys, tabKey, pattern),
  readRedisKey: (tabKey, key) => ipcRenderer.invoke(IPC.redisReadKey, tabKey, key),
  hasRedisKey: (tabKey, key) => ipcRenderer.invoke(IPC.redisHasKey, tabKey, key),
  runRedisCommands: (tabKey, lines) => ipcRenderer.invoke(IPC.redisRunCommands, tabKey, lines),
  readRedisDatabases: (tabKey) => ipcRenderer.invoke(IPC.redisDatabases, tabKey),
  readRedisCommands: (tabKey) => ipcRenderer.invoke(IPC.redisCommands, tabKey),
  pickDataSourceExportFile: (fileName, format) =>
    ipcRenderer.invoke(IPC.dataSourcePickExportFile, fileName, format),
  exportDataSourceTable: (tabKey, request, format, file) =>
    ipcRenderer.invoke(IPC.dataSourceExportTable, tabKey, request, format, file),
  exportDataSourceRows: (kind, result, format, file) =>
    ipcRenderer.invoke(IPC.dataSourceExportRows, kind, result, format, file),

  getServers: () => ipcRenderer.invoke(IPC.serversGet),
  listSshConfigHosts: () => ipcRenderer.invoke(IPC.serverSshConfigHosts),
  addServers: (inputs) => ipcRenderer.invoke(IPC.serverAdd, inputs),
  updateServer: (id, input) => ipcRenderer.invoke(IPC.serverUpdate, id, input),
  removeServer: (id) => ipcRenderer.invoke(IPC.serverRemove, id),
  touchServer: (id) => ipcRenderer.invoke(IPC.serverTouch, id),
  pickSshIdentityFile: () => ipcRenderer.invoke(IPC.serverPickIdentityFile),
  testServerConnection: (input) => ipcRenderer.invoke(IPC.serverTest, input),
  cancelServerTest: () => ipcRenderer.invoke(IPC.serverTestCancel),
  getServerStatus: (serverId) => ipcRenderer.invoke(IPC.serverStatusGet, serverId),
  connectServerStatus: (serverId) => ipcRenderer.invoke(IPC.serverStatusConnect, serverId),
  disconnectServerStatus: (serverId) => ipcRenderer.invoke(IPC.serverStatusDisconnect, serverId),
  onServerStatusChanged: (cb) => subscribe(IPC.serverStatusChanged, cb),
  getServerFilesState: (serverId) => ipcRenderer.invoke(IPC.serverFilesGet, serverId),
  connectServerFiles: (serverId) => ipcRenderer.invoke(IPC.serverFilesConnect, serverId),
  disconnectServerFiles: (serverId) => ipcRenderer.invoke(IPC.serverFilesDisconnect, serverId),
  onServerFilesStateChanged: (cb) => subscribe(IPC.serverFilesStateChanged, cb),
  serverFilesListDir: (serverId, dir) => ipcRenderer.invoke(IPC.serverFilesListDir, serverId, dir),
  serverFilesStat: (serverId, path) => ipcRenderer.invoke(IPC.serverFilesStat, serverId, path),
  serverFilesRead: (serverId, path, force) =>
    ipcRenderer.invoke(IPC.serverFilesRead, serverId, path, force),
  serverFilesCancelRead: (serverId) => ipcRenderer.invoke(IPC.serverFilesReadCancel, serverId),
  onServerFilesReadProgress: (cb) => subscribe(IPC.serverFilesReadProgress, cb),
  serverFilesWrite: (serverId, path, content, base) =>
    ipcRenderer.invoke(IPC.serverFilesWrite, serverId, path, content, base),
  serverFilesCreate: (serverId, dir, name, kind) =>
    ipcRenderer.invoke(IPC.serverFilesCreate, serverId, dir, name, kind),
  serverFilesRename: (serverId, path, newName) =>
    ipcRenderer.invoke(IPC.serverFilesRename, serverId, path, newName),
  serverFilesDelete: (serverId, path) => ipcRenderer.invoke(IPC.serverFilesDelete, serverId, path),
  onServerFilesEntriesChanged: (cb) => subscribe(IPC.serverFilesEntriesChanged, cb),
  serverFilesGetUi: (serverId) => ipcRenderer.invoke(IPC.serverFilesGetUi, serverId),
  serverFilesSetUi: (serverId, patch) => ipcRenderer.invoke(IPC.serverFilesSetUi, serverId, patch),
  serverFilesUpload: (serverId, remoteDir, localPaths) =>
    ipcRenderer.invoke(IPC.serverFilesUpload, serverId, remoteDir, localPaths),
  serverFilesUploadPick: (serverId, remoteDir, kind) =>
    ipcRenderer.invoke(IPC.serverFilesUploadPick, serverId, remoteDir, kind),
  serverFilesDownload: (serverId, path, isDirectory) =>
    ipcRenderer.invoke(IPC.serverFilesDownload, serverId, path, isDirectory),
  getServerTransfers: (serverId) => ipcRenderer.invoke(IPC.serverTransfersGet, serverId),
  onServerTransfersChanged: (cb) => subscribe(IPC.serverTransfersChanged, cb),
  cancelServerTransfer: (serverId, id) =>
    ipcRenderer.invoke(IPC.serverTransferCancel, serverId, id),
  dismissServerTransfer: (serverId, id) =>
    ipcRenderer.invoke(IPC.serverTransferDismiss, serverId, id),
  onTransferConflictRequest: (cb) => subscribe(IPC.transferConflictRequest, cb),
  onTransferConflictDismiss: (cb) => subscribe(IPC.transferConflictDismiss, cb),
  respondTransferConflict: (response) => ipcRenderer.send(IPC.transferConflictRespond, response),
  reportUnsavedServerFiles: (count) => ipcRenderer.send(IPC.serverFilesUnsavedCount, count),
  onServersChanged: (cb) => subscribe(IPC.serversChanged, cb),
  onSshPromptRequest: (cb) => subscribe(IPC.sshPromptRequest, cb),
  onSshPromptDismiss: (cb) => subscribe(IPC.sshPromptDismiss, cb),
  respondSshPrompt: (response) => ipcRenderer.send(IPC.sshPromptRespond, response),

  run: (target: RunTarget) => ipcRenderer.invoke(IPC.run, target),
  stop: (key) => ipcRenderer.invoke(IPC.stop, key),
  writeStdin: (key, data) => ipcRenderer.send(IPC.stdin, key, data),
  resize: (key, cols, rows) => ipcRenderer.send(IPC.resize, key, cols, rows),
  setTerminalFocused: (focused) => ipcRenderer.send(IPC.terminalFocus, focused),
  getSessionBuffer: (key) => ipcRenderer.invoke(IPC.sessionBuffer, key),
  clearSessionOutput: (key) => ipcRenderer.invoke(IPC.sessionClear, key),
  getSessions: () => ipcRenderer.invoke(IPC.sessions),
  getDataSourceRunOutput: (key) => ipcRenderer.invoke(IPC.dataSourceRunOutputGet, key),
  onDataSourceRunOutput: (cb) => subscribe(IPC.dataSourceRunOutput, cb),
  getRunParams: (configId) => ipcRenderer.invoke(IPC.runParamsGet, configId),
  setRunParams: (configId, params) => ipcRenderer.invoke(IPC.runParamsSet, configId, params),

  openTerminal: (projectPath, key, cwd) =>
    ipcRenderer.invoke(IPC.terminalOpen, projectPath, key, cwd),
  openSshTerminal: (ownerKey, serverId, key, cwd) =>
    ipcRenderer.invoke(IPC.sshTerminalOpen, ownerKey, serverId, key, cwd),
  closeSession: (key) => ipcRenderer.invoke(IPC.sessionClose, key),
  getTerminals: () => ipcRenderer.invoke(IPC.terminals),
  getWorkspaceUi: () => ipcRenderer.invoke(IPC.workspaceUiGet),
  setWorkspaceUi: (state) => ipcRenderer.invoke(IPC.workspaceUiSet, state),

  createCommandConfig: (input) => ipcRenderer.invoke(IPC.configCreate, input),
  updateCommandConfig: (config) => ipcRenderer.invoke(IPC.configUpdate, config),
  deleteConfig: (id) => ipcRenderer.invoke(IPC.configDelete, id),
  reorderConfigs: (ownerKey, orderedIds) =>
    ipcRenderer.invoke(IPC.configReorder, ownerKey, orderedIds),
  pickConfigCwd: (projectPath, currentCwd) =>
    ipcRenderer.invoke(IPC.configPickCwd, projectPath, currentCwd),
  promoteScript: (projectPath, source, scriptName) =>
    ipcRenderer.invoke(IPC.scriptPromote, projectPath, source, scriptName),

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  revealInFolder: (path) => ipcRenderer.invoke(IPC.openInFolder, path),
  listOpenInApps: () => ipcRenderer.invoke(IPC.openInAppList),
  openInApp: (id, projectPath) => ipcRenderer.invoke(IPC.openInApp, id, projectPath),
  previewSetRoot: (root) => ipcRenderer.invoke(IPC.previewSetRoot, root),
  previewAddProject: (root) => ipcRenderer.invoke(IPC.previewAddProject, root),
  previewOpenRoot: (projectPath) => ipcRenderer.invoke(IPC.previewOpenRoot, projectPath),
  compressScan: (options) => ipcRenderer.invoke(IPC.compressScan, options),
  compressTargetExists: (dir, name) => ipcRenderer.invoke(IPC.compressTargetExists, dir, name),
  compressPickDir: (defaultPath) => ipcRenderer.invoke(IPC.compressPickDir, defaultPath),
  compressStart: (request) => ipcRenderer.invoke(IPC.compressStart, request),
  compressCancel: () => ipcRenderer.invoke(IPC.compressCancel),
  onCompressProgress: (cb) => subscribe(IPC.compressProgress, cb),
  getSystemIntegration: () => ipcRenderer.invoke(IPC.integrationGet),
  applySystemIntegration: (id, enable) => ipcRenderer.invoke(IPC.integrationApply, id, enable),

  filesListDir: (projectPath, dirPath) =>
    ipcRenderer.invoke(IPC.filesListDir, projectPath, dirPath),
  filesFilterTree: (projectPath, query) =>
    ipcRenderer.invoke(IPC.filesFilterTree, projectPath, query),
  filesRead: (projectPath, filePath) => ipcRenderer.invoke(IPC.filesRead, projectPath, filePath),
  filesWrite: (projectPath, filePath, content) =>
    ipcRenderer.invoke(IPC.filesWrite, projectPath, filePath, content),
  filesHeadText: (projectPath, filePath) =>
    ipcRenderer.invoke(IPC.filesHeadText, projectPath, filePath),
  filesImagePreview: (projectPath, filePath) =>
    ipcRenderer.invoke(IPC.filesImagePreview, projectPath, filePath),
  filesImagePyramid: (projectPath, filePath) =>
    ipcRenderer.invoke(IPC.filesImagePyramid, projectPath, filePath),
  filesCreate: (projectPath, dirPath, name, kind) =>
    ipcRenderer.invoke(IPC.filesCreate, projectPath, dirPath, name, kind),
  filesRename: (projectPath, entryPath, newName) =>
    ipcRenderer.invoke(IPC.filesRename, projectPath, entryPath, newName),
  filesTrash: (projectPath, entryPath) =>
    ipcRenderer.invoke(IPC.filesTrash, projectPath, entryPath),
  filesCopyFile: (path) => ipcRenderer.invoke(IPC.filesCopyFile, path),
  filesCompress: (path) => ipcRenderer.invoke(IPC.filesCompress, path),
  filesGetUi: (projectPath) => ipcRenderer.invoke(IPC.filesGetUi, projectPath),
  filesSetUi: (projectPath, patch) => ipcRenderer.invoke(IPC.filesSetUi, projectPath, patch),
  onFilesChanged: (cb) => subscribe(IPC.filesChanged, cb),

  contentSearchStart: (projectPath, query, options, seq) =>
    ipcRenderer.invoke(IPC.contentSearchStart, projectPath, query, options, seq),
  contentSearchStop: () => ipcRenderer.invoke(IPC.contentSearchStop),
  onContentSearchEvent: (cb) => subscribe(IPC.contentSearchEvent, cb),

  gitLoad: (projectPath, options: GitLoadOptions) =>
    ipcRenderer.invoke(IPC.gitLoad, projectPath, options),
  gitDetails: (projectPath, request: GitDetailsRequest) =>
    ipcRenderer.invoke(IPC.gitDetails, projectPath, request),
  gitFileDiff: (projectPath, request: GitDiffRequest) =>
    ipcRenderer.invoke(IPC.gitFileDiff, projectPath, request),
  gitFileImage: (projectPath, request: GitDiffRequest) =>
    ipcRenderer.invoke(IPC.gitFileImage, projectPath, request),
  gitTagDetails: (projectPath, tagName) =>
    ipcRenderer.invoke(IPC.gitTagDetails, projectPath, tagName),
  gitRepoConfig: (projectPath) => ipcRenderer.invoke(IPC.gitRepoConfig, projectPath),
  gitAction: (projectPath, action: GitAction, opts?: { silent?: boolean }) =>
    ipcRenderer.invoke(IPC.gitAction, projectPath, action, opts),
  gitGetSettings: (projectPath) => ipcRenderer.invoke(IPC.gitSettingsGet, projectPath),
  gitSetSettings: (projectPath, patch) =>
    ipcRenderer.invoke(IPC.gitSettingsSet, projectPath, patch),
  gitGetViewPrefs: () => ipcRenderer.invoke(IPC.gitViewPrefsGet),
  gitSetViewPrefs: (patch) => ipcRenderer.invoke(IPC.gitViewPrefsSet, patch),
  onGitChanged: (cb) => subscribe(IPC.gitChanged, cb),
  gitRevalidate: (projectPath) => ipcRenderer.invoke(IPC.gitRevalidate, projectPath),
  gitDefaultBranch: (projectPath) => ipcRenderer.invoke(IPC.gitDefaultBranch, projectPath),

  onTreeChanged: (cb) => subscribe(IPC.treeChanged, cb),
  onSessionOutput: (cb) => subscribe(IPC.sessionOutput, cb),
  onSessionStatus: (cb) => subscribe(IPC.sessionStatus, cb),
  onSessionRemoved: (cb) => subscribe(IPC.sessionRemoved, cb),
  onAppShortcut: (cb) => subscribe(IPC.appShortcut, cb),
  onProjectExternalOpen: (cb) => subscribe(IPC.projectExternalOpen, cb),

  getAppUpdateState: () => ipcRenderer.invoke(IPC.appUpdateGet),
  checkAppUpdates: (force) => ipcRenderer.invoke(IPC.appUpdateCheck, force === true),
  performAppUpdateAction: () => ipcRenderer.invoke(IPC.appUpdatePerform),
  onAppUpdateState: (cb) => subscribe(IPC.appUpdateState, cb),
  getDevChangelogPreview: () => ipcRenderer.invoke(IPC.appUpdateDevPreview)
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
// only if context isolation is enabled, otherwise just add to the DOM global.
// 拖拽文件夹入面板时，用 webUtils 取真实路径（contextIsolation 下 File.path 已不可用）。
const drop = { getPathForFile: (file: File): string => webUtils.getPathForFile(file) }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('drop', drop)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.drop = drop
}
