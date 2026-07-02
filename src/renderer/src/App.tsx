import { useEffect } from 'react'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { Console } from '@renderer/components/Console'
import { ConfigDialog } from '@renderer/components/ConfigDialog'
import { resolveTabs, useApp } from '@renderer/store'

// 在当前项目「实际显示」的全部 Tab 间循环。dir: +1 下一个 / -1 上一个。
// 运行控制台（null 槽）仅在有内容可显示时才参与循环——与 Console 共用 resolveTabs 解析。
function cycleTab(projectPath: string, dir: 1 | -1): void {
  const st = useApp.getState()
  const { projTerminals, runShown, showRun, activeTermKey } = resolveTabs(st, projectPath)
  const tabs: (string | null)[] = [...(runShown ? [null] : []), ...projTerminals.map((t) => t.key)]
  if (tabs.length === 0) return
  const current: string | null = showRun ? null : activeTermKey
  const idx = tabs.indexOf(current)
  const next = tabs[(idx + dir + tabs.length) % tabs.length]
  if (next === null) st.activateRunConsole(projectPath)
  else st.selectTerminal(next)
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
    document.title = projectName ? `${projectName} — Run` : 'Run'
  }, [projectName])

  useEffect(() => {
    init()
    const offTree = window.api.onTreeChanged((tree) => useApp.getState().setTree(tree))
    const offStatus = window.api.onSessionStatus((s) => useApp.getState().setSession(s))
    const offRemoved = window.api.onSessionRemoved((key) =>
      useApp.getState().handleSessionRemoved(key)
    )
    return () => {
      offTree()
      offStatus()
      offRemoved()
    }
  }, [init])

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
        // Cmd/Ctrl+W：关闭当前「实际显示」的终端 Tab（与 Console 同解析）。运行控制台/无终端时不关；
        // 但当前项目存在即一律吞掉，绝不冒泡到系统默认 Cmd+W 误关整个窗口（会连带杀掉所有终端/进程）。
        e.preventDefault()
        e.stopPropagation()
        const { activeTermKey } = resolveTabs(st, proj)
        if (activeTermKey) st.closeTerminal(activeTermKey)
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
