import { useEffect } from 'react'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { Console } from '@renderer/components/Console'
import { ConfigDialog } from '@renderer/components/ConfigDialog'
import { useFiles } from '@renderer/files-store'
import { orderedTabKeys, resolveTabs, useApp } from '@renderer/store'
import { gitState, useGit } from '@renderer/git-store'
import type { AppShortcut } from '@shared/app-shortcut'
import { filterProjectNodes, sortProjectNodes } from '@shared/project-sort'
import { isResidentTabKey } from '@shared/runnable'

// 在当前项目的全部 Tab（Git + Files + 运行会话 + 终端）间循环。dir: +1 下一个 / -1 上一个。
function cycleTab(projectPath: string, dir: 1 | -1): void {
  const st = useApp.getState()
  const ordered = orderedTabKeys(st, projectPath)
  if (ordered.length === 0) return
  const { activeKey } = resolveTabs(st, projectPath)
  const idx = ordered.indexOf(activeKey)
  const next =
    idx < 0
      ? dir === 1
        ? ordered[0]
        : ordered[ordered.length - 1]
      : ordered[(idx + dir + ordered.length) % ordered.length]
  st.activateTab(projectPath, next)
}

/** 直达当前项目第 n 个 Tab（1-based）；越界则忽略。 */
function activateTabAt(projectPath: string, index1: number): void {
  const st = useApp.getState()
  const key = orderedTabKeys(st, projectPath)[index1 - 1]
  if (key) st.activateTab(projectPath, key)
}

/**
 * 在左树当前可见序（排序 + 筛选，含 Pin 分区）上切换项目。
 * dir: -1 上一项 / +1 下一项；循环；滚入视口。
 */
function cycleProject(dir: 1 | -1): void {
  const st = useApp.getState()
  const nodes = filterProjectNodes(
    sortProjectNodes(st.tree, st.projectSortPrefs),
    st.projectFilter
  )
  if (nodes.length === 0) return
  const idx = nodes.findIndex((n) => n.project.path === st.currentProjectPath)
  const next =
    idx < 0
      ? dir === 1
        ? nodes[0]
        : nodes[nodes.length - 1]
      : nodes[(idx + dir + nodes.length) % nodes.length]
  const path = next.project.path
  if (path === st.currentProjectPath) return
  st.selectProject(path)
  useApp.setState({ scrollToProjectPath: path })
}

function handleAppShortcut(shortcut: AppShortcut): void {
  const st = useApp.getState()
  const proj = st.currentProjectPath

  switch (shortcut.id) {
    case 'focusProjectFilter':
      st.focusProjectFilter()
      return
    case 'focusFilesFilter':
      if (proj) useFiles.getState().focusFilesFilter(proj)
      return
    case 'prevProject':
      cycleProject(-1)
      return
    case 'nextProject':
      cycleProject(1)
      return
    case 'prevTab':
      if (proj) cycleTab(proj, -1)
      return
    case 'nextTab':
      if (proj) cycleTab(proj, 1)
      return
    case 'tabAt':
      if (proj) activateTabAt(proj, shortcut.index)
      return
    case 'newTerminal':
      if (proj) void st.newTerminal(proj)
      return
    case 'closeTab': {
      // 有当前项目即吞掉（主进程已 preventDefault），避免落到系统 Cmd+W 关窗。
      if (!proj) return
      const { activeKey } = resolveTabs(st, proj)
      if (!isResidentTabKey(activeKey)) void st.closeTab(activeKey)
      return
    }
    case 'cycleTabNext':
      if (proj) cycleTab(proj, 1)
      return
    case 'cycleTabPrev':
      if (proj) cycleTab(proj, -1)
      return
  }
}

function App(): React.JSX.Element {
  const init = useApp((s) => s.init)
  const dialog = useApp((s) => s.dialog)
  // 当前项目名（无当前项目 / 树里暂未找到则为 null）；驱动窗口标题。
  const projectName = useApp((s) =>
    s.currentProjectPath
      ? (s.tree.find((n) => n.project.path === s.currentProjectPath)?.project.name ?? null)
      : null
  )

  // 窗口标题跟随当前选中的项目（主进程未固定 title、未拦 page-title-updated，document.title 会自动反映）。
  useEffect(() => {
    document.title = projectName ? `${projectName} — DevCube` : 'DevCube'
  }, [projectName])

  const currentProjectPath = useApp((s) => s.currentProjectPath)

  useEffect(() => {
    init()
    const offTree = window.api.onTreeChanged((tree) => useApp.getState().setTree(tree))
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
    return () => {
      offTree()
      offStatus()
      offRemoved()
      offGit()
      offShortcut()
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

  return (
    <div className="flex h-full">
      <ProjectTree />
      <Console />
      {dialog.open && <ConfigDialog key={dialog.config?.id ?? 'new'} />}
    </div>
  )
}

export default App
