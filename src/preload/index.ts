import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { CommandRunConfig, RunAPI, RunTarget } from '../shared/types'
import type { GitAction, GitDetailsRequest, GitDiffRequest, GitLoadOptions } from '../shared/git'

function subscribe<T>(channel: string, cb: (arg: T) => void): () => void {
  const listener = (_e: unknown, arg: T): void => cb(arg)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RunAPI = {
  getTree: () => ipcRenderer.invoke(IPC.treeGet),
  addProject: () => ipcRenderer.invoke(IPC.projectAdd),
  addProjectByPath: (path) => ipcRenderer.invoke(IPC.projectAddByPath, path),
  createProject: () => ipcRenderer.invoke(IPC.projectCreate),
  removeProject: (path) => ipcRenderer.invoke(IPC.projectRemove, path),
  reorderProjects: (orderedPaths) => ipcRenderer.invoke(IPC.projectReorder, orderedPaths),
  touchProject: (path) => ipcRenderer.invoke(IPC.projectTouch, path),
  getProjectSortPrefs: () => ipcRenderer.invoke(IPC.projectSortPrefsGet),
  setProjectSortPrefs: (patch) => ipcRenderer.invoke(IPC.projectSortPrefsSet, patch),

  run: (target: RunTarget) => ipcRenderer.invoke(IPC.run, target),
  stop: (key) => ipcRenderer.invoke(IPC.stop, key),
  writeStdin: (key, data) => ipcRenderer.send(IPC.stdin, key, data),
  resize: (key, cols, rows) => ipcRenderer.send(IPC.resize, key, cols, rows),
  getSessionBuffer: (key) => ipcRenderer.invoke(IPC.sessionBuffer, key),
  clearSessionOutput: (key) => ipcRenderer.invoke(IPC.sessionClear, key),
  getSessions: () => ipcRenderer.invoke(IPC.sessions),

  openTerminal: (projectPath) => ipcRenderer.invoke(IPC.terminalOpen, projectPath),
  closeSession: (key) => ipcRenderer.invoke(IPC.sessionClose, key),
  getTerminals: () => ipcRenderer.invoke(IPC.terminals),

  createCommandConfig: (input: Omit<CommandRunConfig, 'id' | 'kind'>) =>
    ipcRenderer.invoke(IPC.configCreate, input),
  updateCommandConfig: (config) => ipcRenderer.invoke(IPC.configUpdate, config),
  deleteConfig: (id) => ipcRenderer.invoke(IPC.configDelete, id),
  reorderConfigs: (projectPath, orderedIds) =>
    ipcRenderer.invoke(IPC.configReorder, projectPath, orderedIds),
  promoteScript: (projectPath, scriptName) =>
    ipcRenderer.invoke(IPC.scriptPromote, projectPath, scriptName),

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  revealInFolder: (path) => ipcRenderer.invoke(IPC.openInFolder, path),

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
  onSessionRemoved: (cb) => subscribe(IPC.sessionRemoved, cb)
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
