import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useApp } from '@renderer/store'
import { xtermTheme } from '@renderer/lib/xterm-theme'

export function Console(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selectedRef = useRef<string | null>(null)
  const selectedKey = useApp((s) => s.selectedKey)

  // 终端只创建一次，跨选择复用。
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
      if (e.key === selectedRef.current) term.write(e.data)
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
    const term = termRef.current
    if (!term) return
    term.reset()
    if (!selectedKey) return
    window.api.getSessionBuffer(selectedKey).then((buffer) => {
      if (selectedRef.current !== selectedKey) return
      term.write(buffer)
      try {
        fitRef.current?.fit()
      } catch {
        /* noop */
      }
      window.api.resize(selectedKey, term.cols, term.rows)
    })
  }, [selectedKey])

  return (
    <div className="relative h-full min-w-0 flex-1 bg-deepest">
      <div ref={containerRef} className="h-full w-full p-1" />
      {!selectedKey && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          选中左侧一个可运行项查看输出
        </div>
      )}
    </div>
  )
}
