import { useEffect } from 'react'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { Console } from '@renderer/components/Console'
import { ConfigDialog } from '@renderer/components/ConfigDialog'
import { resolveTabs, useApp } from '@renderer/store'
import { gitState, useGit } from '@renderer/git-store'
import { isResidentTabKey } from '@shared/runnable'

// 在当前项目的全部 Tab（Git + Files + 运行会话 + 终端）间循环。dir: +1 下一个 / -1 上一个。
// 与 Console 共用 resolveTabs 解析。
function cycleTab(projectPath: string, dir: 1 | -1): void {
  const st = useApp.getState()
  const { gitKey, filesKey, runTabs, termTabs, activeKey } = resolveTabs(st, projectPath)
  const ordered = [
    gitKey,
    filesKey,
    ...runTabs.map((t) => t.key),
    ...termTabs.map((t) => t.key)
  ]
  const idx = ordered.indexOf(activeKey)
  const next =
    idx < 0
      ? dir === 1
        ? ordered[0]
        : ordered[ordered.length - 1]
      : ordered[(idx + dir + ordered.length) % ordered.length]
  st.activateTab(projectPath, next)
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
    return () => {
      offTree()
      offStatus()
      offRemoved()
      offGit()
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

  // 终端 Tab 快捷键。capture 阶段拦截，抢在 xterm 之前，避免被下发给 pty。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      // 焦点在真正的输入控件（命令对话框、Tab 改名框、搜索框等）时让位，不抢 T/W/Tab；
      // xterm 自己的输入是 .xterm 内的 textarea，不算——终端聚焦时快捷键照常生效。
      const el = e.target as HTMLElement | null
      const editable =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (editable && !el.closest('.xterm')) return
      const st = useApp.getState()
      const proj = st.currentProjectPath
      if (!proj) return
      // Cmd/Ctrl+T：在当前项目新建终端。
      if (mod && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        e.stopPropagation()
        st.newTerminal(proj)
      } else if (mod && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        // Cmd/Ctrl+W：关闭当前激活的会话 Tab；常驻 Git / Files 不可关。
        // 当前项目存在即一律吞掉，绝不冒泡到系统默认 Cmd+W 误关窗口。
        e.preventDefault()
        e.stopPropagation()
        const { activeKey } = resolveTabs(st, proj)
        if (!isResidentTabKey(activeKey)) st.closeTab(activeKey)
      } else if (e.ctrlKey && e.key === 'Tab') {
        // Ctrl+Tab / Ctrl+Shift+Tab：在当前项目的 Tab 间循环。
        e.preventDefault()
        e.stopPropagation()
        cycleTab(proj, e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="flex h-full">
      <ProjectTree />
      <Console />
      {dialog.open && <ConfigDialog key={dialog.config?.id ?? 'new'} />}
    </div>
  )
}

export default App
