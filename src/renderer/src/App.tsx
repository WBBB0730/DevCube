import { useEffect, useState } from 'react'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { Console } from '@renderer/components/Console'
import { SshPromptDialog } from '@renderer/components/SshPromptDialog'
import { TransferConflictDialog } from '@renderer/components/TransferConflictDialog'
import { UnsavedChangesDialog } from '@renderer/components/UnsavedChangesDialog'
import { CloneProjectDialog } from '@renderer/components/CloneProjectDialog'
import { ConfigDialog } from '@renderer/components/ConfigDialog'
import { ServerDialog } from '@renderer/components/ServerDialog'
import { DataSourceDialog } from '@renderer/components/DataSourceDialog'
import { RunParamsDialog } from '@renderer/components/RunParamsDialog'
import { ContentSearchPanel } from '@renderer/components/ContentSearchPanel'
import { AppTitleBar } from '@renderer/components/AppTitleBar'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { isDialogOpen } from '@renderer/components/ui/dialog'
import { ConfirmDialog } from '@renderer/components/ui/form-dialog'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import { useDataSourceUi } from '@renderer/data-source-store'
import { countExecutedStatements } from '@renderer/lib/data-source-completion-usage'
import { useRememberedPanel } from '@renderer/lib/remembered-panel'
import { useFiles } from '@renderer/files-store'
import { orderedTabKeys, resolveTabs, useApp } from '@renderer/store'
import { gitState, useGit } from '@renderer/git-store'
import type { AppShortcut } from '@shared/app-shortcut'
import type { AppUpdateState } from '@shared/app-update-state'
import { filterTreeEntries, sortTreeEntries } from '@shared/project-sort'
import { isResidentTabKey } from '@shared/runnable'
import {
  buildTreeEntries,
  dataSourceIdOfEntryKey,
  entryItem,
  entryKindOfKey,
  serverIdOfEntryKey
} from '@shared/tree-entry'
import { GIT_DEFAULTS } from '@shared/git'

// 按 Tab 栏顺序在当前条目的全部 Tab（常驻 Tab、运行会话、终端组，见 resolveTabs）间循环。dir: +1 下一个 / -1 上一个。
function cycleTab(entryKey: string, dir: 1 | -1): void {
  const st = useApp.getState()
  const ordered = orderedTabKeys(st, entryKey)
  if (ordered.length === 0) return
  const { activeKey } = resolveTabs(st, entryKey)
  const idx = activeKey === null ? -1 : ordered.indexOf(activeKey)
  const next =
    idx < 0
      ? dir === 1
        ? ordered[0]
        : ordered[ordered.length - 1]
      : ordered[(idx + dir + ordered.length) % ordered.length]
  st.activateTab(entryKey, next)
}

/** 直达当前条目第 n 个 Tab（1-based）；越界则忽略。 */
function activateTabAt(entryKey: string, index1: number): void {
  const st = useApp.getState()
  const key = orderedTabKeys(st, entryKey)[index1 - 1]
  if (key) st.activateTab(entryKey, key)
}

/**
 * 在左树当前可见序（排序 + 筛选，含 Pin 分区）上切换条目（Project / Server / Data Source）。
 * dir: -1 上一项 / +1 下一项；循环；滚入视口。
 */
function cycleEntry(dir: 1 | -1): void {
  const st = useApp.getState()
  const entries = filterTreeEntries(
    sortTreeEntries(buildTreeEntries(st.tree, st.servers, st.dataSources), st.projectSortPrefs),
    st.projectFilter,
    st.projectSortPrefs
  )
  if (entries.length === 0) return
  const idx = entries.findIndex((e) => e.key === st.currentEntryKey)
  const next =
    idx < 0
      ? dir === 1
        ? entries[0]
        : entries[entries.length - 1]
      : entries[(idx + dir + entries.length) % entries.length]
  if (next.key === st.currentEntryKey) return
  st.selectEntry(next.key)
  useApp.setState({ scrollToEntryKey: next.key })
}

function handleAppShortcut(shortcut: AppShortcut): void {
  // 弹窗显示着即模态：切 Tab / 切项目等应用快捷键一律不响应（同 WebStorm；主进程已吞掉按键）
  if (isDialogOpen()) return
  const st = useApp.getState()
  const entry = st.currentEntryKey
  const kind = entry === null ? null : entryKindOfKey(entry)
  // 内容搜索只对 Project 有意义；Files Tab 只有 Project 与 Server 有（服务器上 ⌥⌘F 聚焦「前往路径」）
  const proj = kind === 'project' ? entry : null
  const filesEntry = kind === 'project' || kind === 'server' ? entry : null
  const dataSourceEntry = kind === 'dataSource' ? entry : null

  switch (shortcut.id) {
    case 'focusProjectFilter':
      st.focusProjectFilter()
      return
    case 'focusFilesFilter':
      if (filesEntry) useFiles.getState().focusFilesFilter(filesEntry)
      return
    case 'contentSearch':
      if (proj) st.setContentSearchOpen(true)
      return
    case 'recentFiles':
      // 项目与服务器为 Files 的最近打开文件；数据源为它的 Data Source Tab 的最近打开对象（Redis 为键）
      if (filesEntry) useFiles.getState().openRecentMenu(filesEntry)
      else if (dataSourceEntry) useDataSourceUi.getState().openRecentMenu(dataSourceEntry)
      return
    case 'prevProject':
      cycleEntry(-1)
      return
    case 'nextProject':
      cycleEntry(1)
      return
    case 'prevTab':
      if (entry) cycleTab(entry, -1)
      return
    case 'nextTab':
      if (entry) cycleTab(entry, 1)
      return
    case 'tabAt':
      if (entry) activateTabAt(entry, shortcut.index)
      return
    case 'newTerminal': {
      if (!entry) return
      // Server 条目的「新建终端」即再开一个连到它的 SSH Terminal；Data Source 条目即再开一个 Data Source Tab（都立即连接）
      const serverId = serverIdOfEntryKey(entry)
      const dataSourceId = dataSourceIdOfEntryKey(entry)
      if (serverId !== null) void st.newSshTerminal(entry, serverId)
      else if (dataSourceId !== null) st.newDataSourceTab(entry, dataSourceId)
      else void st.newTerminal(entry)
      return
    }
    case 'closeTab': {
      // 有当前条目即吞掉（主进程已 preventDefault），避免落到系统 Cmd+W 关窗。
      if (!entry) return
      const { activeKey } = resolveTabs(st, entry)
      if (activeKey !== null && !isResidentTabKey(activeKey)) void st.closeTab(activeKey)
      return
    }
    case 'cycleTabNext':
      if (entry) cycleTab(entry, 1)
      return
    case 'cycleTabPrev':
      if (entry) cycleTab(entry, -1)
      return
  }
}

function App(): React.JSX.Element {
  const init = useApp((s) => s.init)
  const dialog = useApp((s) => s.dialog)
  const connectionDialog = useApp((s) => s.connectionDialog)
  const sshPrompt = useApp((s) => s.sshPromptQueue[0] ?? null)
  const transferConflict = useApp((s) => s.transferConflictQueue[0] ?? null)
  const unsavedPrompt = useApp((s) => s.unsavedPrompt)
  const confirmPrompt = useApp((s) => s.confirmPrompt)
  const runParamsPrompt = useApp((s) => s.runParamsPrompt)
  // 当前条目名（无当前条目 / 暂未找到则为 null）；驱动窗口标题。
  const entryName = useApp((s) => {
    const key = s.currentEntryKey
    if (key === null) return null
    const entry = buildTreeEntries(s.tree, s.servers, s.dataSources).find((e) => e.key === key)
    return entry ? entryItem(entry).name : null
  })

  const windowTitle = entryName ? `${entryName} — DevCube` : 'DevCube'

  // 窗口标题跟随当前选中的项目（主进程未固定 title、未拦 page-title-updated，document.title 会自动反映）。
  useEffect(() => {
    document.title = windowTitle
  }, [windowTitle])

  // 当前条目若是 Project 即其路径（Git 预加载、内容搜索只对 Project）
  const currentProjectPath = useApp((s) =>
    s.currentEntryKey !== null && entryKindOfKey(s.currentEntryKey) === 'project'
      ? s.currentEntryKey
      : null
  )
  const contentSearchOpen = useApp((s) => s.contentSearchOpen)
  const cloneDialogOpen = useApp((s) => s.cloneDialogOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [update, setUpdate] = useState<AppUpdateState | null>(null)

  useEffect(() => {
    void init()
    const offTree = window.api.onTreeChanged((tree) => useApp.getState().setTree(tree))
    const offServers = window.api.onServersChanged((servers) =>
      useApp.getState().setServers(servers)
    )
    const offDataSources = window.api.onDataSourcesChanged((dataSources) =>
      useApp.getState().setDataSources(dataSources)
    )
    // SSH 的提问（主机指纹、密码、私钥口令、验证码）：排队弹窗；连接已结束的提问随之撤掉。
    const offSshPrompt = window.api.onSshPromptRequest((request) =>
      useApp.getState().enqueueSshPrompt(request)
    )
    const offSshPromptDismiss = window.api.onSshPromptDismiss((id) =>
      useApp.getState().dismissSshPrompt(id)
    )
    // 上传 / 下载遇到同名文件：排队弹窗；传输被取消时随之撤掉。
    const offConflict = window.api.onTransferConflictRequest((request) =>
      useApp.getState().enqueueTransferConflict(request)
    )
    const offConflictDismiss = window.api.onTransferConflictDismiss((id) =>
      useApp.getState().dismissTransferConflict(id)
    )
    // 数据源执行成功了语句（控制台与运行配置）：交给补全计数（越常用越靠前）。
    const offExecuted = window.api.onDataSourceExecuted((event) => {
      void countExecutedStatements(event)
    })
    const offStatus = window.api.onSessionStatus((s) => useApp.getState().setSession(s))
    const offRemoved = window.api.onSessionRemoved((key) =>
      useApp.getState().handleSessionRemoved(key)
    )
    // 仓库变化（.git 变动 / git 动作完成）→ 软刷新对应项目的图谱；从未加载过的项目跳过。
    const offGit = window.api.onGitChanged((projectPath) => {
      const git = useGit.getState()
      if (git.projects[projectPath]) void git.load(projectPath)
    })
    // 应用快捷键：主进程 before-input-event → IPC（抢在 xterm / 编辑器 / Chromium 默认之前）。
    const offShortcut = window.api.onAppShortcut(handleAppShortcut)
    const offUpdate = window.api.onAppUpdateState(setUpdate)
    // External Open：main 已登记项目，这里选中并滚入视口。
    const offExternalOpen = window.api.onProjectExternalOpen((focusPath) => {
      void useApp.getState().openExternalProject(focusPath)
    })
    void window.api.getAppUpdateState().then(setUpdate)
    return () => {
      offTree()
      offServers()
      offDataSources()
      offSshPrompt()
      offSshPromptDismiss()
      offConflict()
      offConflictDismiss()
      offExecuted()
      offStatus()
      offRemoved()
      offGit()
      offShortcut()
      offUpdate()
      offExternalOpen()
    }
  }, [init])

  // 当前项目提前全量 load：Tab 栏始终能显示分支名，不必等点开 Git Tab。
  // 仅 idle 时触发；已加载过的靠 onGitChanged 软刷新保鲜。load 同步置 loading，StrictMode 双挂载幂等。
  useEffect(() => {
    if (!currentProjectPath) return
    const git = useGit.getState()
    if (gitState(git, currentProjectPath).status === 'idle') {
      void git.load(currentProjectPath)
    }
  }, [currentProjectPath])

  // 自动获取的定时部分：每隔固定间隔「刷新」当时的当前项目（不论选中哪个 Tab、窗口是否在前台）；
  // 在途跳过、失败不弹框。Git Tab 到前台那一下由 GitPane 触发，两者撞上时由 refresh 的在途判断去重。
  const gitAutoFetch = useApp((s) => s.gitAutoFetch)
  useEffect(() => {
    if (!gitAutoFetch) return
    const timer = setInterval(() => {
      const entryKey = useApp.getState().currentEntryKey
      if (entryKey !== null && entryKindOfKey(entryKey) === 'project') {
        void useGit.getState().refresh(entryKey, { suppressErrorBox: true })
      }
    }, GIT_DEFAULTS.autoFetchIntervalMs)
    return () => clearInterval(timer)
  }, [gitAutoFetch])

  const projectTree = useRememberedPanel('projectTree')

  return (
    <div className="flex h-full flex-col">
      <AppTitleBar
        title={windowTitle}
        update={update}
        onOpenSettings={() => setSettingsOpen(true)}
        onPerformUpdate={() => void window.api.performAppUpdateAction()}
      />
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup {...projectTree.groupProps}>
          <ResizablePanel {...projectTree.panelProps}>
            <ProjectTree />
          </ResizablePanel>
          <ResizableHandle {...projectTree.handleProps} />
          <ResizablePanel>
            <Console />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {dialog && (
        <ConfigDialog
          key={dialog.config?.id ?? 'new'}
          ownerKey={dialog.ownerKey}
          config={dialog.config}
        />
      )}
      {connectionDialog?.kind === 'server' && (
        <ServerDialog
          key={connectionDialog.node?.server.id ?? 'new'}
          node={connectionDialog.node}
        />
      )}
      {connectionDialog?.kind === 'dataSource' && (
        <DataSourceDialog
          key={connectionDialog.node?.dataSource.id ?? 'new'}
          node={connectionDialog.node}
        />
      )}
      {unsavedPrompt && (
        <UnsavedChangesDialog name={unsavedPrompt.name} onChoose={unsavedPrompt.resolve} />
      )}
      {confirmPrompt && (
        <ConfirmDialog
          title={confirmPrompt.title}
          message={confirmPrompt.message}
          buttons={[
            {
              label: confirmPrompt.confirmLabel,
              destructive: confirmPrompt.destructive,
              onClick: () => confirmPrompt.resolve(true)
            }
          ]}
          onCancel={() => confirmPrompt.resolve(false)}
        />
      )}
      {runParamsPrompt && (
        <RunParamsDialog key={runParamsPrompt.configId} prompt={runParamsPrompt} />
      )}
      {/* SSH 提问排在同名询问之后渲染，叠在它上面 */}
      {transferConflict && (
        <TransferConflictDialog key={transferConflict.id} request={transferConflict} />
      )}
      {sshPrompt && <SshPromptDialog key={sshPrompt.id} request={sshPrompt} />}
      {cloneDialogOpen && <CloneProjectDialog />}
      {contentSearchOpen && currentProjectPath && (
        <ContentSearchPanel
          key={currentProjectPath}
          projectPath={currentProjectPath}
          onClose={() => useApp.getState().setContentSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          update={update}
          onClose={() => setSettingsOpen(false)}
          onCheckUpdate={async (force) => {
            // 状态只经 IPC 推送，避免 invoke 返回值与 push 竞态盖掉更新结果。
            await window.api.checkAppUpdates(force)
          }}
          onPerformUpdate={() => void window.api.performAppUpdateAction()}
          onOpenRepo={() => {
            if (update) void window.api.openExternal(update.repoUrl)
          }}
        />
      )}
    </div>
  )
}

export default App
