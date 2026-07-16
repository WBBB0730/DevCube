import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  FolderOpen,
  GitBranch,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
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
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SessionOutput, SessionStatus } from '@shared/types'
import { configKey, filesTabKey, gitTabKey } from '@shared/runnable'
import { useApp, resolveTabs, type RunTabInfo, type TerminalTab } from '@renderer/store'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { xtermTheme } from '@renderer/lib/xterm-theme'
import { GitPane } from '@renderer/components/git/GitPane'
import { FilesPane } from '@renderer/components/files/FilesPane'
import { abbrevHash } from '@renderer/components/git/git-format'

// 常驻 xterm 会各持一个 WebGL 上下文；浏览器/Electron 对同页上下文数有硬上限（约 16）。
// 给全局加载数封顶，超出的终端回退默认渲染，避免挤掉后台终端的上下文造成静默降级。
const MAX_WEBGL = 12
let webglCount = 0

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
  const tree = useApp((s) => s.tree)
  const sessions = useApp((s) => s.sessions)
  const terminals = useApp((s) => s.terminals)
  const activeTabByProject = useApp((s) => s.activeTabByProject)

  if (!currentProjectPath) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-deepest">
        <Placeholder />
      </div>
    )
  }

  // 与 cycleTab / 关闭快捷键共用同一解析规则（见 store.resolveTabs）。
  const { gitKey, filesKey, runTabs, termTabs, activeKey } = resolveTabs(
    { tree, sessions, terminals, activeTabByProject },
    currentProjectPath
  )

  // 运行会话面板：全部项目的会话都常驻（与终端一致——切走仅隐藏，切回项目现场保留）。
  const termKeys = new Set(terminals.map((t) => t.key))
  const runSessionKeys = Object.keys(sessions).filter((k) => !termKeys.has(k))

  // 仅当激活的是运行会话 Tab 时出操作栏（Git / Files / 终端 Tab 不出）。
  const activeRunTab = runTabs.find((t) => t.key === activeKey) ?? null

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-deepest">
      <TabBar
        projectPath={currentProjectPath}
        gitKey={gitKey}
        filesKey={filesKey}
        runTabs={runTabs}
        termTabs={termTabs}
        activeKey={activeKey}
      />
      {activeRunTab && (
        <RunActionBar projectPath={currentProjectPath} tab={activeRunTab} />
      )}
      <div className="relative min-h-0 flex-1">
        {/* Git 面板：每个项目常驻一个（切走仅隐藏；当前项目由 App 预加载，见 GitPane）。 */}
        {tree.map((n) => {
          const gk = gitTabKey(n.project.path)
          const visible = n.project.path === currentProjectPath && gk === activeKey
          return (
            <div key={gk} className={cn('absolute inset-0', !visible && 'hidden')}>
              <GitPane projectPath={n.project.path} visible={visible} />
            </div>
          )
        })}
        {/* Files 面板：每项目常驻（切走仅隐藏）。 */}
        {tree.map((n) => {
          const fk = filesTabKey(n.project.path)
          const visible = n.project.path === currentProjectPath && fk === activeKey
          return (
            <div key={fk} className={cn('absolute inset-0', !visible && 'hidden')}>
              <FilesPane projectPath={n.project.path} visible={visible} />
            </div>
          )
        })}
        {runSessionKeys.map((k) => {
          const visible = k === activeKey
          return (
            <div key={k} className={cn('absolute inset-0', !visible && 'hidden')}>
              <TerminalPane paneKey={k} mode="run" visible={visible} />
            </div>
          )
        })}
        {terminals.map((t) => {
          const visible = t.key === activeKey
          return (
            <div key={t.key} className={cn('absolute inset-0', !visible && 'hidden')}>
              <TerminalPane paneKey={t.key} mode="terminal" visible={visible} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 运行会话操作栏：仅在激活运行会话 Tab 时出现（Tab 栏下方）。
// 仅按钮：运行/重跑、停止、清空；无配置名/状态文案（Tab 已承载）。
// 高 40px、底 --bg-panel、底边 1px --separator；按钮 size-7、间距 gap-1.5，与左树一致。
const ACTION_BTN = 'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors'

function RunActionBar({
  projectPath,
  tab
}: {
  projectPath: string
  tab: RunTabInfo
}): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const session = useApp((s) => s.sessions[tab.key])
  const run = useApp((s) => s.run)
  const stop = useApp((s) => s.stop)
  const clearOutput = useApp((s) => s.clearOutput)

  const config = tree
    .find((n) => n.project.path === projectPath)
    ?.configs.find((c) => configKey(c) === tab.key)

  const running = session?.status === 'running'

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--separator)] bg-panel px-1.5">
      <button
        type="button"
        title={running ? '重新运行' : '运行'}
        className={cn(
          ACTION_BTN,
          running
            ? 'bg-[var(--run-active-bg)] text-white hover:bg-[var(--run-active-bg-hover)]'
            : 'text-[var(--run-glyph)] hover:bg-[var(--bg-button-hover)]'
        )}
        onClick={() => {
          if (!config) return
          run({ type: 'config', id: config.id }, tab.key, projectPath)
        }}
        disabled={!config}
      >
        {running ? <RotateCw className="size-4" /> : <Play className="size-4" />}
      </button>
      <button
        type="button"
        title="停止"
        disabled={!running}
        className={cn(
          ACTION_BTN,
          running
            ? 'bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)]'
            : 'text-muted-foreground opacity-40'
        )}
        onClick={() => stop(tab.key)}
      >
        <Square className="size-4" />
      </button>
      <button
        type="button"
        title="清空输出"
        className={cn(
          ACTION_BTN,
          'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
        )}
        onClick={() => clearOutput(tab.key)}
      >
        <Eraser className="size-4" />
      </button>
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

// 单个 Tab 外壳样式：与左标题栏同高、无圆角、彼此紧贴；选中态用主色下描边（inset box-shadow，不占布局）。
// 右内边距 8px：12px 的 × 图标在 16px 按钮内居中内缩 2px，8+2=10px 即图标到右边缘的距离。
const TAB =
  'flex h-full max-w-[220px] cursor-pointer select-none items-center gap-1.5 pl-2.5 text-[14px] transition-colors hover:bg-[var(--bg-row-hover)]'
const TAB_ACTIVE = { boxShadow: 'inset 0 -3px 0 0 var(--primary)' } as const

// 关闭键（运行会话/终端 Tab 共用）：16px 按钮 + 12px 图标；常驻，背景仅 hover 显示（圆形 + 颜色过渡）。
// ml-1 叠加 Tab 的 gap-1.5：文字到关闭键 10px（比文字到左侧图标的 6px 更宽）。
const TAB_CLOSE =
  'ml-1 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

// 终端 Tab 组内拖拽：仅水平移动，且钳制在终端组容器内（containerNodeRect 即被拖项父容器）。
const restrictToHorizontalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect
}) => {
  const t = { ...transform, y: 0 }
  if (!draggingNodeRect || !containerNodeRect) return t
  if (draggingNodeRect.left + t.x < containerNodeRect.left) {
    t.x = containerNodeRect.left - draggingNodeRect.left
  } else if (draggingNodeRect.right + t.x > containerNodeRect.right) {
    t.x = containerNodeRect.right - draggingNodeRect.right
  }
  return t
}

function TabBar({
  projectPath,
  gitKey,
  filesKey,
  runTabs,
  termTabs,
  activeKey
}: {
  projectPath: string
  gitKey: string
  filesKey: string
  runTabs: RunTabInfo[]
  termTabs: TerminalTab[]
  activeKey: string
}): React.JSX.Element {
  const newTerminal = useApp((s) => s.newTerminal)
  const reorderTerminals = useApp((s) => s.reorderTerminals)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const keys = termTabs.map((t) => t.key)
    const from = keys.indexOf(active.id as string)
    const to = keys.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    reorderTerminals(projectPath, arrayMove(keys, from, to))
  }

  return (
    <div className="flex h-10 shrink-0 items-center overflow-x-auto border-b border-[var(--separator)] bg-panel px-2">
      {/* Git Tab：每项目常驻第一个、不可关闭（ADR-0005）。 */}
      <GitTabItem gitKey={gitKey} projectPath={projectPath} active={gitKey === activeKey} />
      {/* Files Tab：常驻第二、不可关闭。 */}
      <FilesTabItem filesKey={filesKey} projectPath={projectPath} active={filesKey === activeKey} />
      {/* 运行会话 Tab：每条有会话的配置一个，顺序跟随树中配置顺序。 */}
      {runTabs.map((t) => (
        <RunTabItem key={t.key} tab={t} active={t.key === activeKey} projectPath={projectPath} />
      ))}
      {/* 终端 Tab：组内可拖拽排序（仅水平、不与运行会话组混排）。 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalWithinList]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={termTabs.map((t) => t.key)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex h-full shrink-0 items-center">
            {termTabs.map((t) => (
              <TerminalTabItem key={t.key} tab={t} active={t.key === activeKey} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        title="新建终端 (⌘T)"
        onClick={() => newTerminal(projectPath)}
        className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

// Git Tab：图标 + 「Git」+ 「(分支名)」，无关闭键（左右内边距对称 pl-3/pr-3 即 12px，
// 其余 Tab 右侧有 × 故 pr-2）。分支名来自 git-store：当前项目由 App 预加载，不必等点开
// Git Tab；此后 git:changed 软刷新保鲜（检出/提交即时跟随）；detached HEAD 回落缩写 hash。
function GitTabItem({
  gitKey,
  projectPath,
  active
}: {
  gitKey: string
  projectPath: string
  active: boolean
}): React.JSX.Element {
  const activateTab = useApp((s) => s.activateTab)
  const branch = useGit((s) => {
    const st = gitState(s, projectPath)
    return st.currentBranch ?? (st.headHash !== null ? abbrevHash(st.headHash) : null)
  })
  return (
    <div
      className={cn(TAB, 'pl-3 pr-3')}
      style={active ? TAB_ACTIVE : undefined}
      onClick={() => activateTab(projectPath, gitKey)}
    >
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-foreground">Git</span>
      {branch !== null && (
        <span className="min-w-0 truncate text-muted-foreground" title={branch}>
          ({branch})
        </span>
      )}
    </div>
  )
}

function FilesTabItem({
  filesKey,
  projectPath,
  active
}: {
  filesKey: string
  projectPath: string
  active: boolean
}): React.JSX.Element {
  const activateTab = useApp((s) => s.activateTab)
  return (
    <div
      className={cn(TAB, 'pl-3 pr-3')}
      style={active ? TAB_ACTIVE : undefined}
      onClick={() => activateTab(projectPath, filesKey)}
    >
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-foreground">文件</span>
    </div>
  )
}

function RunTabItem({
  tab,
  active,
  projectPath
}: {
  tab: RunTabInfo
  active: boolean
  projectPath: string
}): React.JSX.Element {
  const activateTab = useApp((s) => s.activateTab)
  const closeTab = useApp((s) => s.closeTab)

  return (
    <div
      className={cn(TAB, 'group pr-2')}
      style={active ? TAB_ACTIVE : undefined}
      onClick={() => activateTab(projectPath, tab.key)}
    >
      <span
        className="size-2 shrink-0 rounded-full transition-colors"
        style={{ background: STATUS_DOT[tab.status] }}
      />
      <span className="min-w-0 truncate text-foreground">{tab.label}</span>
      <button
        type="button"
        title={tab.status === 'running' ? '停止并关闭 (⌘W)' : '关闭 (⌘W)'}
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.key)
        }}
        className={TAB_CLOSE}
      >
        <X className="size-3" />
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
  const activateTab = useApp((s) => s.activateTab)
  const closeTab = useApp((s) => s.closeTab)
  const renameTerminal = useApp((s) => s.renameTerminal)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tab.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.key
  })
  const style: React.CSSProperties = {
    // 只取位移、丢弃缩放：列表策略对不同宽度的条目会算出 scaleX（按目标位置尺寸），
    // 用 CSS.Transform 会把拖拽中的 Tab 拉伸变形。
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
    ...(active ? TAB_ACTIVE : {})
  }

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
      ref={setNodeRef}
      style={style}
      className={cn(TAB, 'group pr-2')}
      {...attributes}
      {...(editing ? {} : listeners)}
      onClick={() => activateTab(tab.projectPath, tab.key)}
      onDoubleClick={() => {
        setDraft(tab.name)
        setEditing(true)
      }}
    >
      <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
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
      <button
        type="button"
        title="关闭 (⌘W)"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.key)
        }}
        className={TAB_CLOSE}
      >
        <X className="size-3" />
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
 * 按累计偏移（bytes）去重写入：已被覆盖的块跳过，跨越边界的只补超出部分。
 * 实时路径与回填 flush 必须共用此协议——sessionOutput 事件与快照回复走不同派发通道，
 * 到达顺序没有保证，快照已含的块（如运行头部）可能在回填完成后才到达，直写即重复。
 * bytes 只在同一会话代（sid）内可比：重跑即换代重计，调用方必须先滤掉跨代事件。
 */
function writeDeduped(
  term: Terminal,
  written: { current: number },
  ev: Pick<SessionOutput, 'data' | 'bytes'>
): void {
  if (ev.bytes <= written.current) return
  const start = ev.bytes - ev.data.length
  term.write(start >= written.current ? ev.data : ev.data.slice(written.current - start))
  written.current = ev.bytes
}

/**
 * 一块终端画布。mode='run' 绑定一条配置的会话（重跑经 runNonce 触发清屏回填、退出只读）；
 * mode='terminal' 绑定终端会话、始终可交互。切走用 visible=false 隐藏而非卸载。
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
  // 回填期间暂存实时输出，快照写入后按代际过滤、按累计偏移去重补齐，消除「快照 vs 实时」竞态窗口。
  const pendingRef = useRef<SessionOutput[]>([])
  const writtenRef = useRef(0)
  // 当前已应用快照的会话代际；ready 后只接受同代事件（跨代 bytes 不可比，见 writeDeduped）。
  const sidRef = useRef('')
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ index: -1, count: 0 })
  // 仅 run 模式订阅自己会话的运行序号 / 状态；终端模式取常量，避免无谓触发（如别的配置重跑）。
  // 终端懒 spawn：会话从无到有时需重新回填快照（否则挂载时空缓冲会把 ready 置真并丢掉新 sid 输出）。
  const runNonce = useApp((s) => (mode === 'run' ? (s.runNonce[paneKey] ?? 0) : 0))
  const status = useApp((s) => (mode === 'run' ? s.sessions[paneKey]?.status : undefined))
  const terminalLive = useApp((s) => (mode === 'terminal' ? !!s.sessions[paneKey] : true))

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
      if (!readyRef.current) {
        // 回填尚未完成：先入队，待快照写入后按代际过滤、按偏移去重补齐（避免丢字/重复）。
        pendingRef.current.push(e)
      } else if (e.sid === sidRef.current) {
        writeDeduped(term, writtenRef, e)
      }
      // ready 后 sid 不符 = 重跑换代的事件：主进程 run 必经 runNonce +1，本面板随即 reset
      // 并重新回填，其内容由新快照带回，直接丢弃即可。
    })
    const disposeInput = term.onData((data) => {
      window.api.writeStdin(keyRef.current, data)
    })
    const ro = new ResizeObserver(() => {
      // 隐藏面板（display:none）容器无尺寸：fit 静默不生效，若照发 resize 会把 pty
      // 压回 xterm 默认的 80x24，令 shell 重画提示符污染缓冲（刷新后回填即错乱）。
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
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

  // 挂载 / 重跑（runNonce +1）：run 清屏后回填该会话快照；可见时聚焦。
  // 终端模式在会话活着时回填（含懒 spawn 后）；未 spawn 时不置 ready，避免丢掉新 sid 输出。
  useEffect(() => {
    keyRef.current = paneKey
    readyRef.current = false
    pendingRef.current = []
    writtenRef.current = 0
    const term = termRef.current
    if (!term) return
    if (mode === 'terminal' && !terminalLive) return
    if (mode === 'run') term.reset()
    // 过期回填必须作废：keyRef 挡不住「同 key 的上一代请求」（StrictMode 双挂载、快速重跑
    // 都会产生同 key 的在途快照）——旧快照若在 reset 后应用，会写入过期内容、污染 writtenRef
    // 并提前置 ready / 清 pending，导致丢输出或错排。
    let cancelled = false
    window.api.getSessionBuffer(paneKey).then((snap) => {
      if (cancelled || keyRef.current !== paneKey) return
      // 先把 xterm 调到快照对应的 pty 尺寸再写入（序列化屏幕按该宽度编码，见 ADR-0004）。
      // 可见时随后 fit 回容器宽度并由 xterm 重排。
      if (snap.cols > 0 && snap.rows > 0 && (term.cols !== snap.cols || term.rows !== snap.rows)) {
        term.resize(snap.cols, snap.rows)
      }
      term.write(snap.data)
      // 序列化快照不携带光标可见性：已结束的运行会话补一笔隐藏光标（与退出页脚一致）。
      if (mode === 'run' && useApp.getState().sessions[paneKey]?.status !== 'running') {
        term.write('\x1b[?25l')
      }
      writtenRef.current = snap.bytes
      sidRef.current = snap.sid
      // flush 回填期间入队的实时事件：只认与快照同代的（如快速重跑时旧会话的在途残留，
      // 其旧累计 bytes 会污染写入进度），再走同一去重协议（见 writeDeduped）。
      for (const ev of pendingRef.current) {
        if (ev.sid === snap.sid) writeDeduped(term, writtenRef, ev)
      }
      pendingRef.current = []
      readyRef.current = true
      // 仅可见面板才按容器 refit 并同步 pty；隐藏面板保持快照尺寸，等变可见再统一 fit。
      if (visibleRef.current) {
        try {
          fitRef.current?.fit()
        } catch {
          /* noop */
        }
        window.api.resize(paneKey, term.cols, term.rows)
        term.focus()
      }
    })
    return () => {
      cancelled = true
    }
  }, [paneKey, runNonce, mode, terminalLive])

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
