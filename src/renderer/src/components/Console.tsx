import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Play, Search, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import type { ProjectNode, SessionStatus } from '@shared/types'
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
        <div className="flex h-full items-center justify-center gap-1.5 px-6 text-sm text-muted-foreground">
          <span>点击</span>
          <Play className="size-4 text-[var(--run-glyph)]" />
          <span>运行配置</span>
        </div>
      )}
    </div>
  )
}

// 搜索高亮配色：取自 Shell.icls 的 SEARCH_RESULT（绿）；activeMatch 取更亮的绿。
const SEARCH_OPTS: ISearchOptions = {
  decorations: {
    matchBackground: '#2d543f',
    matchOverviewRuler: '#42bd77',
    activeMatchBackground: '#3d7a49',
    activeMatchColorOverviewRuler: '#42bd77'
  }
}

// 状态点配色（与左侧列表一致）。
const STATUS_DOT: Record<SessionStatus | 'idle', string> = {
  idle: 'var(--status-idle)',
  running: 'var(--status-running)',
  exited: 'var(--status-success)',
  failed: 'var(--status-failed)'
}

function TerminalView({ selectedKey }: { selectedKey: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const selectedRef = useRef<string>(selectedKey)
  const readyRef = useRef(false)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ index: -1, count: 0 })
  const label = useApp((s) => findLabel(s.tree, selectedKey))
  const session = useApp((s) => s.sessions[selectedKey])
  const focusNonce = useApp((s) => s.focusNonce)

  // 终端随本组件挂载/卸载创建与销毁。
  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      // JetBrains Mono 在 xterm(WebGL/macOS) 上渲染偏细，上调一档补偿，观感接近 WebStorm。
      fontWeight: 500,
      theme: xtermTheme,
      cursorBlink: true,
      scrollback: 10000,
      // Unicode 11 字宽用到 xterm 的 proposed API（term.unicode），必须开启。
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 终端链接点击交给主进程用系统浏览器打开（默认 window.open 在 Electron 里不合适）。
    term.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    // 结果计数（当前 / 总数）；decorations 开启时才会触发。
    const offResults = search.onDidChangeResults((e) =>
      setResults({ index: e.resultIndex, count: e.resultCount })
    )
    // Unicode 11 字宽：emoji / CJK 对齐。
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    // Cmd/Ctrl+F 唤出搜索框（拦截，不下发给 pty）。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        setSearchOpen(true)
        return false
      }
      return true
    })
    term.open(containerRef.current!)
    // WebGL 渲染器须在 open 之后加载；不可用则回退默认 DOM 渲染。
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* WebGL 不可用，忽略 */
    }
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
      offResults.dispose()
      disposeInput.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [])

  // 选择变化 / 运行 / 重跑：清屏、聚焦并回填该会话缓冲。
  // 重跑当前项时 selectedKey 不变，靠 focusNonce 触发清屏（后端此时已换成空缓冲的新会话）。
  useEffect(() => {
    selectedRef.current = selectedKey
    readyRef.current = false
    const term = termRef.current
    if (!term) return
    term.reset()
    term.focus() // 切换 / 运行 / 首次挂载即把焦点落到终端，可直接输入。
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
  }, [selectedKey, focusNonce])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  // 进程结束后终端只读：禁止输入（含粘贴），但选中 / 复制 / 搜索照常；运行中恢复输入。
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.disableStdin = session?.status !== 'running'
  }, [session?.status])

  const runFind = (dir: 'next' | 'prev', value = query): void => {
    const s = searchRef.current
    if (!s) return
    if (!value) {
      s.clearDecorations()
      return
    }
    if (dir === 'prev') s.findPrevious(value, SEARCH_OPTS)
    else s.findNext(value, SEARCH_OPTS)
  }

  const closeSearch = (): void => {
    setSearchOpen(false)
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }

  const searchBtn =
    'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

  // 有输入才显示计数：有结果 x/y，无结果「0 个结果」；空输入不显示。
  const countLabel =
    query === ''
      ? null
      : results.count === 0
        ? '0 个结果'
        : results.index >= 0
          ? `${results.index + 1}/${results.count}`
          : `${results.count}`

  return (
    <>
      {/* 顶栏与左侧标题栏同高同色（bg-panel/h-10）；选中态 Tab 用主色下边框标示。 */}
      <div className="flex h-10 shrink-0 items-center bg-panel px-2">
        {/* 描边用 inset box-shadow（不占布局高度），文字在整栏含描边区垂直居中。 */}
        <div
          className="flex h-full max-w-[280px] items-center gap-2 rounded-t-md pl-3 pr-4 text-[14px] transition-colors hover:bg-[var(--bg-row-hover)]"
          style={{ boxShadow: 'inset 0 -3px 0 0 var(--primary)' }}
        >
          <span
            className="size-2 shrink-0 rounded-full transition-colors"
            style={{ background: STATUS_DOT[session?.status ?? 'idle'] }}
          />
          <span className="min-w-0 truncate text-foreground">{label}</span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full p-2" />
        {searchOpen && (
          <div className="absolute right-3 top-2 z-20 flex w-80 items-center gap-1 rounded-lg border border-[color:var(--border-input)] bg-panel px-1.5 py-1 shadow-xl">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                runFind('next', e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runFind(e.shiftKey ? 'prev' : 'next')
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  closeSearch()
                }
              }}
              placeholder="搜索输出"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {countLabel && (
              <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {countLabel}
              </span>
            )}
            <button
              type="button"
              title="上一个 (Shift+Enter)"
              onClick={() => runFind('prev')}
              className={searchBtn}
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              title="下一个 (Enter)"
              onClick={() => runFind('next')}
              className={searchBtn}
            >
              <ChevronDown className="size-4" />
            </button>
            <button type="button" title="关闭 (Esc)" onClick={closeSearch} className={searchBtn}>
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </>
  )
}
