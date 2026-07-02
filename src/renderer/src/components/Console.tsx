import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Play,
  Plus,
  Search,
  Terminal as TerminalIcon,
  X
} from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import type { ProjectNode, SessionStatus } from '@shared/types'
import { configKey, scriptKey } from '@shared/runnable'
import { useApp, resolveTabs, type TerminalTab } from '@renderer/store'
import { cn } from '@renderer/lib/utils'
import { xtermTheme } from '@renderer/lib/xterm-theme'

// 常驻 xterm 会各持一个 WebGL 上下文；浏览器/Electron 对同页上下文数有硬上限（约 16）。
// 给全局加载数封顶，超出的终端回退默认渲染，避免挤掉后台终端的上下文造成静默降级。
const MAX_WEBGL = 12
let webglCount = 0

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

function Placeholder(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center gap-1.5 px-6 text-sm text-muted-foreground">
      <span>点击</span>
      <Play className="size-4 text-[var(--run-glyph)]" />
      <span>运行配置</span>
    </div>
  )
}

export function Console(): React.JSX.Element {
  const currentProjectPath = useApp((s) => s.currentProjectPath)
  const selectedKey = useApp((s) => s.selectedKey)
  const terminals = useApp((s) => s.terminals)
  const sessions = useApp((s) => s.sessions)
  const activeTerminalByProject = useApp((s) => s.activeTerminalByProject)

  if (!currentProjectPath) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-deepest">
        <Placeholder />
      </div>
    )
  }

  // 与 cycleTab / 关闭快捷键共用同一解析规则（见 store.resolveTabs）。
  const { projTerminals, runShown, showRun, activeTermKey } = resolveTabs(
    { terminals, selectedKey, sessions, activeTerminalByProject },
    currentProjectPath
  )
  const nothing = !showRun && activeTermKey === null

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-deepest">
      <TabBar
        projectPath={currentProjectPath}
        projTerminals={projTerminals}
        runShown={runShown}
        showRun={showRun}
        activeTermKey={activeTermKey}
      />
      <div className="relative min-h-0 flex-1">
        {/* 运行控制台层（Tab 1）：仅当有内容时才存在；跟随选中配置、退出后只读。 */}
        {runShown && selectedKey && (
          <div className={cn('absolute inset-0', !showRun && 'hidden')}>
            <TerminalPane paneKey={selectedKey} mode="run" visible={showRun} />
          </div>
        )}
        {/* 各终端层：全部常驻，切走仅隐藏，故 shell 后台仍在跑、现场保留。 */}
        {terminals.map((t) => {
          const visible = t.projectPath === currentProjectPath && t.key === activeTermKey
          return (
            <div key={t.key} className={cn('absolute inset-0', !visible && 'hidden')}>
              <TerminalPane paneKey={t.key} mode="terminal" visible={visible} />
            </div>
          )
        })}
        {nothing && <Placeholder />}
      </div>
    </div>
  )
}

// 状态点配色（与左侧列表一致）。
const STATUS_DOT: Record<SessionStatus | 'idle', string> = {
  idle: 'var(--status-idle)',
  running: 'var(--status-running)',
  exited: 'var(--status-success)',
  failed: 'var(--status-failed)'
}

// 单个 Tab 外壳样式：与左标题栏同高，选中态用主色下描边（inset box-shadow，不占布局）。
const TAB =
  'flex h-full max-w-[220px] cursor-pointer select-none items-center gap-2 rounded-t-md pl-3 text-[14px] transition-colors hover:bg-[var(--bg-row-hover)]'
const TAB_ACTIVE = { boxShadow: 'inset 0 -3px 0 0 var(--primary)' } as const

function TabBar({
  projectPath,
  projTerminals,
  runShown,
  showRun,
  activeTermKey
}: {
  projectPath: string
  projTerminals: TerminalTab[]
  runShown: boolean
  showRun: boolean
  activeTermKey: string | null
}): React.JSX.Element {
  const label = useApp((s) => (s.selectedKey ? findLabel(s.tree, s.selectedKey) : null))
  const runStatus = useApp(
    (s) => (s.selectedKey ? s.sessions[s.selectedKey]?.status : undefined) ?? 'idle'
  )
  const activateRunConsole = useApp((s) => s.activateRunConsole)
  const newTerminal = useApp((s) => s.newTerminal)

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto bg-panel px-2">
      {/* Tab 1 · 运行控制台：仅当有内容可显示时才渲染（不可关闭）。 */}
      {runShown && (
        <div
          className={cn(TAB, 'pr-4')}
          style={showRun ? TAB_ACTIVE : undefined}
          onClick={() => activateRunConsole(projectPath)}
        >
          <span
            className="size-2 shrink-0 rounded-full transition-colors"
            style={{ background: STATUS_DOT[runStatus] }}
          />
          <span className="min-w-0 truncate text-foreground">{label ?? '运行'}</span>
        </div>
      )}
      {projTerminals.map((t) => (
        <TerminalTabItem key={t.key} tab={t} active={t.key === activeTermKey} />
      ))}
      <button
        type="button"
        title="新建终端 (⌘T)"
        onClick={() => newTerminal(projectPath)}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

function TerminalTabItem({
  tab,
  active
}: {
  tab: TerminalTab
  active: boolean
}): React.JSX.Element {
  const selectTerminal = useApp((s) => s.selectTerminal)
  const closeTerminal = useApp((s) => s.closeTerminal)
  const renameTerminal = useApp((s) => s.renameTerminal)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tab.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    const name = draft.trim()
    if (name) renameTerminal(tab.key, name)
    setEditing(false)
  }

  return (
    <div
      className={cn(TAB, 'group pr-1')}
      style={active ? TAB_ACTIVE : undefined}
      onClick={() => selectTerminal(tab.key)}
      onDoubleClick={() => {
        setDraft(tab.name)
        setEditing(true)
      }}
    >
      <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="min-w-0 max-w-[120px] bg-transparent text-[14px] text-foreground outline-none"
        />
      ) : (
        <span className="min-w-0 truncate text-foreground">{tab.name}</span>
      )}
      {/* 关闭键始终占位（opacity 切换），避免 hover 时整 Tab 宽度跳动。 */}
      <button
        type="button"
        title="关闭 (⌘W)"
        onClick={(e) => {
          e.stopPropagation()
          closeTerminal(tab.key)
        }}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X className="size-3.5" />
      </button>
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

/**
 * 一块终端画布。mode='run' 跟随选中配置（切 key / 重跑清屏回填、退出只读）；
 * mode='terminal' 绑定固定会话键、始终可交互。切走用 visible=false 隐藏而非卸载。
 */
function TerminalPane({
  paneKey,
  mode,
  visible
}: {
  paneKey: string
  mode: 'run' | 'terminal'
  visible: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const keyRef = useRef<string>(paneKey)
  const readyRef = useRef(false)
  const visibleRef = useRef(visible)
  // 回填期间暂存实时输出，快照写入后按累计偏移去重补齐，消除「快照 vs 实时」竞态窗口。
  const pendingRef = useRef<{ bytes: number; data: string }[]>([])
  const writtenRef = useRef(0)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ index: -1, count: 0 })
  // 仅 run 模式订阅 focusNonce / 会话状态；终端模式取常量，避免无谓触发（如别处重跑）。
  const focusNonce = useApp((s) => (mode === 'run' ? s.focusNonce : 0))
  const status = useApp((s) => (mode === 'run' ? s.sessions[paneKey]?.status : undefined))

  // 供内容回填的异步回调判断「回填完成时是否可见」以决定聚焦（避免把 visible 塞进 deps 触发重跑）。
  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  // 终端随本组件挂载/卸载创建与销毁。
  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      fontWeight: 500,
      theme: xtermTheme,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    const search = new SearchAddon()
    term.loadAddon(search)
    searchRef.current = search
    const offResults = search.onDidChangeResults((e) =>
      setResults({ index: e.resultIndex, count: e.resultCount })
    )
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        setSearchOpen(true)
        return false
      }
      return true
    })
    term.open(containerRef.current!)
    // WebGL 渲染器须在 open 之后加载；受全局上限约束，超限或不可用则回退默认 DOM 渲染。
    let webglOn = false
    if (webglCount < MAX_WEBGL) {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
        webglCount++
        webglOn = true
      } catch {
        /* WebGL 不可用，忽略 */
      }
    }
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const offOutput = window.api.onSessionOutput((e) => {
      if (e.key !== keyRef.current) return
      if (readyRef.current) {
        term.write(e.data)
        writtenRef.current = e.bytes
      } else {
        // 回填尚未完成：先入队，待快照写入后按偏移去重补齐（避免丢字/重复）。
        pendingRef.current.push({ bytes: e.bytes, data: e.data })
      }
    })
    const disposeInput = term.onData((data) => {
      window.api.writeStdin(keyRef.current, data)
    })
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* 容器可能瞬时无尺寸 */
      }
      window.api.resize(keyRef.current, term.cols, term.rows)
    })
    ro.observe(containerRef.current!)

    return () => {
      offOutput()
      offResults.dispose()
      disposeInput.dispose()
      ro.disconnect()
      term.dispose()
      if (webglOn) webglCount--
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [])

  // 切 key / 重跑：run 清屏后回填该会话缓冲；可见时聚焦。终端模式仅挂载时回填一次。
  useEffect(() => {
    keyRef.current = paneKey
    readyRef.current = false
    pendingRef.current = []
    writtenRef.current = 0
    const term = termRef.current
    if (!term) return
    if (mode === 'run') term.reset()
    window.api.getSessionBuffer(paneKey).then((snap) => {
      if (keyRef.current !== paneKey) return
      term.write(snap.data)
      writtenRef.current = snap.bytes
      // flush 回填期间入队的实时事件：跳过已在快照内的，跨越边界的只补超出部分。
      for (const ev of pendingRef.current) {
        if (ev.bytes <= writtenRef.current) continue
        const start = ev.bytes - ev.data.length
        term.write(
          start >= writtenRef.current ? ev.data : ev.data.slice(writtenRef.current - start)
        )
        writtenRef.current = ev.bytes
      }
      pendingRef.current = []
      readyRef.current = true
      try {
        fitRef.current?.fit()
      } catch {
        /* noop */
      }
      window.api.resize(paneKey, term.cols, term.rows)
      if (visibleRef.current) term.focus()
    })
  }, [paneKey, focusNonce, mode])

  // 变可见：隐藏期间 ResizeObserver 不触发，手动 refit + 聚焦。
  useEffect(() => {
    if (!visible) return
    const term = termRef.current
    if (!term) return
    try {
      fitRef.current?.fit()
    } catch {
      /* noop */
    }
    window.api.resize(paneKey, term.cols, term.rows)
    term.focus()
  }, [visible, paneKey])

  // 只读：run 模式进程结束后禁输入（含粘贴），选中/复制/搜索照常；终端始终可交互。
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.disableStdin = mode === 'run' ? status !== 'running' : false
  }, [status, mode])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

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

  const countLabel =
    query === ''
      ? null
      : results.count === 0
        ? '0 个结果'
        : results.index >= 0
          ? `${results.index + 1}/${results.count}`
          : `${results.count}`

  return (
    <div className="relative h-full w-full">
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
  )
}
