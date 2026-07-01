import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ProjectNode, SessionState } from '@shared/types'
import { configKey, scriptKey } from '@shared/runnable'
import { useApp } from '@renderer/store'
import { xtermTheme } from '@renderer/lib/xterm-theme'

function findLabel(tree: ProjectNode[], key: string): string | null {
  for (const node of tree) {
    for (const s of node.discovered) {
      if (scriptKey(s.projectPath, s.name) === key) return s.name
    }
    for (const c of node.configs) {
      if (configKey(c) === key) return c.kind === 'referenced' ? c.scriptName : c.name
    }
  }
  return null
}

export function Console(): React.JSX.Element {
  const selectedKey = useApp((s) => s.selectedKey)
  // 有会话 = 跑过、有内容 → 渲染终端；否则（未选中 / 选中但没跑过）只显示占位。
  const hasSession = useApp((s) => (s.selectedKey ? !!s.sessions[s.selectedKey] : false))

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-deepest">
      {selectedKey && hasSession ? (
        <TerminalView selectedKey={selectedKey} />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {selectedKey ? '这个配置还没有输出，点运行 ▶ 开始' : '选中左侧一个可运行项查看输出'}
        </div>
      )}
    </div>
  )
}

function TerminalView({ selectedKey }: { selectedKey: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selectedRef = useRef<string>(selectedKey)
  const readyRef = useRef(false)
  const label = useApp((s) => findLabel(s.tree, selectedKey))
  const session = useApp((s) => s.sessions[selectedKey])

  // 终端随本组件挂载/卸载创建与销毁。
  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 13,
      theme: xtermTheme,
      cursorBlink: true,
      scrollback: 10000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const offOutput = window.api.onSessionOutput((e) => {
      // 仅在历史缓冲回填完成后才追加实时输出，避免与回填内容重复/错序。
      if (e.key === selectedRef.current && readyRef.current) term.write(e.data)
    })
    const disposeInput = term.onData((data) => {
      if (selectedRef.current) window.api.writeStdin(selectedRef.current, data)
    })
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* 容器可能瞬时无尺寸 */
      }
      if (selectedRef.current) window.api.resize(selectedRef.current, term.cols, term.rows)
    })
    ro.observe(containerRef.current!)

    return () => {
      offOutput()
      disposeInput.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  // 选择变化：清屏并回填该会话已缓冲的历史输出。
  useEffect(() => {
    selectedRef.current = selectedKey
    readyRef.current = false
    const term = termRef.current
    if (!term) return
    term.reset()
    window.api.getSessionBuffer(selectedKey).then((buffer) => {
      if (selectedRef.current !== selectedKey) return
      term.write(buffer)
      readyRef.current = true
      try {
        fitRef.current?.fit()
      } catch {
        /* noop */
      }
      window.api.resize(selectedKey, term.cols, term.rows)
    })
  }, [selectedKey])

  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-3 text-[12px]">
        <span className="truncate text-foreground">{label}</span>
        <StatusText session={session} />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full p-1" />
      </div>
    </>
  )
}

function StatusText({ session }: { session?: SessionState }): React.JSX.Element | null {
  if (!session) return null
  if (session.status === 'running') {
    return <span style={{ color: 'var(--status-running)' }}>运行中</span>
  }
  if (session.status === 'exited' && session.exitCode === 0) {
    return <span className="text-muted-foreground">已完成</span>
  }
  return <span style={{ color: 'var(--status-failed)' }}>退出码 {session.exitCode}</span>
}
