import { useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
  Trash2
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS as DndCSS } from '@dnd-kit/utilities'
import type {
  DiscoveredScript,
  ProjectNode,
  ProjectSortMode,
  RunConfig,
  RunTarget,
  SessionStatus
} from '@shared/types'
import { configKey, scriptKey } from '@shared/runnable'
import { filterProjectNodes, sortProjectNodes } from '@shared/project-sort'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useApp } from '@renderer/store'

// 所有行统一固定高 + 圆角。四周内边距 6px：px-1.5 各 6px，
// h-10(40px) 让 size-7(28px) 按钮上下各留 6px；固定高避免 hover 出按钮时整行跳动。
const ROW =
  'group flex h-10 cursor-pointer items-center gap-1.5 rounded px-1.5 text-[14px] transition-colors'
const BTN = 'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors'

// 列表仅垂直排序，且钳制在父容器内（containerNodeRect 即被拖行的父容器）。
// 等价 @dnd-kit/modifiers 的 restrictToVerticalAxis + restrictToParentElement，免引依赖。
const restrictToVerticalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect
}) => {
  const t = { ...transform, x: 0 }
  if (!draggingNodeRect || !containerNodeRect) return t
  if (draggingNodeRect.top + t.y < containerNodeRect.top) {
    t.y = containerNodeRect.top - draggingNodeRect.top
  } else if (draggingNodeRect.bottom + t.y > containerNodeRect.bottom) {
    t.y = containerNodeRect.bottom - draggingNodeRect.bottom
  }
  return t
}

const SORT_OPTIONS: { mode: ProjectSortMode; label: string }[] = [
  { mode: 'custom', label: '自定义' },
  { mode: 'name', label: '名称' },
  { mode: 'addedAt', label: '添加时间' },
  { mode: 'lastOpenedAt', label: '打开时间' }
]

export function ProjectTree(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const projectSortPrefs = useApp((s) => s.projectSortPrefs)
  const projectFilter = useApp((s) => s.projectFilter)
  const setProjectFilter = useApp((s) => s.setProjectFilter)
  const cycleSortMode = useApp((s) => s.cycleSortMode)
  const reorderProjects = useApp((s) => s.reorderProjects)
  const addProject = useApp((s) => s.addProject)
  const addProjectByPath = useApp((s) => s.addProjectByPath)
  const createProject = useApp((s) => s.createProject)

  // 拖项目时强制全部收起；松手后恢复各行原展开态（由 forceCollapsed 驱动，不改各行本地 open）。
  // 锚点用「布局视口 Y」= offsetTop - scrollTop（忽略 dnd-kit transform）。
  // 收起后内容变矮，浏览器可能钳制 scrollTop——只补 offsetTop 差会漏掉这一向。
  // 校正：delta < 0（偏上）加 paddingTop；delta > 0（偏下）优先加 scrollTop，
  // 加不动的余量用负 marginTop 上拉并裁掉。
  // 拖拽中向下滚时按增量吃掉 padding，并回退等量 scrollTop，避免位移翻倍。
  // 松手后：记下被拖项视口 top，展开后再用 scrollTop 尽量拉回（不加 padding/margin）。
  const [forceCollapsed, setForceCollapsed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const listContentRef = useRef<HTMLDivElement>(null)
  const collapseAnchorRef = useRef<number | null>(null)
  const collapsePadRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const restoreRef = useRef<{ path: string; clientTop: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const filtered = filterProjectNodes(sortProjectNodes(tree, projectSortPrefs), projectFilter)
  // 有筛选时禁用拖拽；非自定义也可拖，松手且顺序实质变化后才切到自定义并落盘。
  const canDrag = projectFilter.trim() === '' && filtered.length > 1

  useLayoutEffect(() => {
    const list = listRef.current
    const content = listContentRef.current
    if (list === null || content === null) return

    if (forceCollapsed) {
      const anchor = collapseAnchorRef.current
      if (anchor === null) return
      const item = content.querySelector('[data-dragging-project]') as HTMLElement | null
      if (!item) return

      content.style.paddingTop = ''
      content.style.marginTop = ''
      const delta = item.offsetTop - list.scrollTop - anchor

      if (delta < 0) {
        const pad = -delta
        content.style.paddingTop = `${pad}px`
        collapsePadRef.current = pad
      } else if (delta > 0) {
        const before = list.scrollTop
        list.scrollTop += delta
        const scrolled = list.scrollTop - before
        const rest = delta - scrolled
        if (rest > 0) content.style.marginTop = `${-rest}px`
        collapsePadRef.current = 0
      } else {
        collapsePadRef.current = 0
      }
      lastScrollTopRef.current = list.scrollTop
      return
    }

    // 展开后：仅用 scrollTop 尽量把被拖项拉回松手前的视口位置（浏览器钳制即「尽量」）。
    const restore = restoreRef.current
    if (!restore) return
    restoreRef.current = null
    const item = content.querySelector(
      `[data-project-path="${globalThis.CSS.escape(restore.path)}"]`
    ) as HTMLElement | null
    if (!item) return
    list.scrollTop += item.getBoundingClientRect().top - restore.clientTop
  }, [forceCollapsed, filtered])

  const clearCollapsePad = (): void => {
    setForceCollapsed(false)
    collapseAnchorRef.current = null
    collapsePadRef.current = 0
    lastScrollTopRef.current = 0
    const content = listContentRef.current
    if (content) {
      content.style.paddingTop = ''
      content.style.marginTop = ''
    }
  }

  // 向下滚动时按增量吃掉补偿 padding，并回退等量 scrollTop，使视口位移仍为 1×。
  const handleListScroll = (): void => {
    const list = listRef.current
    const content = listContentRef.current
    if (!list || !content) return
    const pad = collapsePadRef.current
    const delta = list.scrollTop - lastScrollTopRef.current
    if (pad > 0 && delta > 0) {
      const consume = Math.min(pad, delta)
      const next = pad - consume
      collapsePadRef.current = next
      content.style.paddingTop = next > 0 ? `${next}px` : ''
      list.scrollTop -= consume
    }
    lastScrollTopRef.current = list.scrollTop
  }

  const handleProjectDragStart = (e: DragStartEvent): void => {
    const list = listRef.current
    const content = listContentRef.current
    const path = e.active.id as string
    const item = content?.querySelector(
      `[data-project-path="${globalThis.CSS.escape(path)}"]`
    ) as HTMLElement | null
    // 布局视口 Y：把 scrollTop 算进锚点，滚到底再收起被钳制时才能双向校正。
    collapseAnchorRef.current =
      item && list ? item.offsetTop - list.scrollTop : null
    setForceCollapsed(true)
  }

  /** 松手前记下被拖项视口 top（含 transform），展开后用 scrollTop 尽量还原。 */
  const captureRestoreAnchor = (path: string): void => {
    const content = listContentRef.current
    const item = content?.querySelector(
      `[data-project-path="${globalThis.CSS.escape(path)}"]`
    ) as HTMLElement | null
    if (item) restoreRef.current = { path, clientTop: item.getBoundingClientRect().top }
  }

  const handleProjectDragEnd = (e: DragEndEvent): void => {
    const path = e.active.id as string
    captureRestoreAnchor(path)
    clearCollapsePad()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const paths = filtered.map((n) => n.project.path)
    const from = paths.indexOf(active.id as string)
    const to = paths.indexOf(over.id as string)
    if (from < 0 || to < 0 || from === to) return
    // 非自定义下拖成新序：先切到自定义，再按当前视觉序落盘；无实质变化则上面已 return，不覆盖原自定义序。
    if (projectSortPrefs.mode !== 'custom') void cycleSortMode('custom')
    reorderProjects(arrayMove(paths, from, to))
  }

  const handleProjectDragCancel = (): void => {
    const content = listContentRef.current
    const item = content?.querySelector('[data-dragging-project]') as HTMLElement | null
    const path = item?.getAttribute('data-project-path')
    if (path) captureRestoreAnchor(path)
    clearCollapsePad()
  }

  const emptyMessage =
    tree.length === 0 ? '拖入文件夹，或点上方 + 新建 / 添加项目' : '无匹配项目'

  // 间距由列表 space-y 统一承担，避免自定义模式多一层 wrapper 时 last:mb-0 误伤每一项。
  const rows = filtered.map((node) =>
    canDrag ? (
      <SortableProjectRow
        key={node.project.path}
        node={node}
        forceCollapsed={forceCollapsed}
      />
    ) : (
      <ProjectRow key={node.project.path} node={node} forceCollapsed={forceCollapsed} />
    )
  )

  return (
    <div
      className="flex h-full w-[280px] shrink-0 flex-col border-r border-[var(--separator)] bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        for (const file of Array.from(e.dataTransfer.files)) {
          await addProjectByPath(window.drop.getPathForFile(file))
        }
      }}
    >
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-1.5 text-muted-foreground">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded px-1.5 transition-colors focus-within:bg-[var(--bg-row-hover)]">
          <Search className="size-3.5 shrink-0 text-[color:var(--fg-disabled)]" />
          <input
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            placeholder="筛选"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)]"
          />
        </div>
        <SortMenu
          mode={projectSortPrefs.mode}
          direction={projectSortPrefs.direction}
          onSelect={cycleSortMode}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            title="新建 / 添加项目"
            className={cn(
              BTN,
              'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
            )}
          >
            <FolderPlus className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={createProject}>新建项目…</DropdownMenuItem>
            <DropdownMenuItem onClick={addProject}>添加现有项目…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div
        ref={listRef}
        className="flex-1 overflow-auto px-1.5 pb-1.5"
        onScroll={forceCollapsed ? handleListScroll : undefined}
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyMessage}</p>
        ) : canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalWithinList]}
            onDragStart={handleProjectDragStart}
            onDragEnd={handleProjectDragEnd}
            onDragCancel={handleProjectDragCancel}
          >
            <SortableContext
              items={filtered.map((n) => n.project.path)}
              strategy={verticalListSortingStrategy}
            >
              <div ref={listContentRef} className="relative space-y-3">
                {rows}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="space-y-3">{rows}</div>
        )}
      </div>
    </div>
  )
}

function SortMenu({
  mode,
  direction,
  onSelect
}: {
  mode: ProjectSortMode
  direction: 'asc' | 'desc'
  onSelect: (mode: ProjectSortMode) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="排序"
        className={cn(
          BTN,
          'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
        )}
      >
        <ArrowUpDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SORT_OPTIONS.map((opt) => {
          const active = mode === opt.mode
          return (
            <DropdownMenuItem key={opt.mode} onClick={() => onSelect(opt.mode)}>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {active && <Check className="size-3.5" />}
              </span>
              <span className="flex-1">{opt.label}</span>
              {active && opt.mode !== 'custom' && (
                direction === 'asc' ? (
                  <ArrowUp className="size-3.5 text-muted-foreground" />
                ) : (
                  <ArrowDown className="size-3.5 text-muted-foreground" />
                )
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortableProjectRow({
  node,
  forceCollapsed
}: {
  node: ProjectNode
  forceCollapsed: boolean
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.project.path
  })
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative'
  }
  // 拖拽句柄只挂项目行头，避免与配置行拖拽冲突；拖时 forceCollapsed 会收起子列表。
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-project-path={node.project.path}
      {...(isDragging ? { 'data-dragging-project': '' } : {})}
    >
      <ProjectRow
        node={node}
        forceCollapsed={forceCollapsed}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

function ProjectRow({
  node,
  forceCollapsed,
  dragHandleProps
}: {
  node: ProjectNode
  forceCollapsed: boolean
  /** 项目拖拽句柄（仅挂在行头） */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const reorderConfigs = useApp((s) => s.reorderConfigs)
  const selectProject = useApp((s) => s.selectProject)
  // 与配置行同层级的互斥选中：仅当「项目本身」被选中（无配置选中）时高亮项目行。
  const selected = useApp(
    (s) => s.currentProjectPath === node.project.path && s.selectedKey === null
  )
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = node.configs.map((c) => c.id)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    reorderConfigs(node.project.path, arrayMove(ids, from, to))
  }

  const expanded = open && !forceCollapsed

  return (
    <div>
      <div
        className={cn(
          ROW,
          'select-none text-foreground',
          selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]'
        )}
        onClick={() => selectProject(node.project.path)}
        onDoubleClick={() => setOpen((v) => !v)}
        {...dragHandleProps}
      >
        {/* 折叠/展开由箭头或整行双击触发（整行单击留给「设为当前项目」）。 */}
        <button
          type="button"
          title={expanded ? '折叠' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
        </button>
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.project.name}</span>
        {node.packageManager && node.packageManager !== 'pnpm' && (
          <span className="text-[12px] text-muted-foreground group-hover:hidden">
            {node.packageManager}
          </span>
        )}
        <IconButton
          title="新建命令"
          selected={selected}
          onClick={(e) => {
            e.stopPropagation()
            openCreateDialog(node.project.path)
          }}
        >
          <Plus className="size-4" />
        </IconButton>
        <ProjectMoreMenu projectPath={node.project.path} selected={selected} />
      </div>
      {expanded && (
        <div className="mt-0.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalWithinList]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={node.configs.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {node.configs.map((c) => (
                <SortableConfigRow key={c.id} config={c} />
              ))}
            </SortableContext>
          </DndContext>
          {node.discovered.length > 0 && <DiscoveredMenu discovered={node.discovered} />}
        </div>
      )}
    </div>
  )
}

// 探测脚本收进一个临时弹出菜单（Base UI Popover），菜单项与配置行同款样式。
// 受控 open：菜单项被选中或运行即刻关闭（选中即晋升，行随之移出候补区）。
function DiscoveredMenu({ discovered }: { discovered: DiscoveredScript[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-0.5">
      <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
        <PopoverTrigger
          className={cn(ROW, 'w-full text-muted-foreground hover:bg-[var(--bg-row-hover)]')}
        >
          {/* 占位补齐折叠箭头列；文案接着圆点列起始，与配置的状态点对齐 */}
          <span className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">检测到的配置</span>
          {/* 数字移到箭头前 */}
          <span className="shrink-0 text-[12px] text-[var(--fg-disabled)]">
            {discovered.length}
          </span>
          {/* 箭头放进 size-7 槽并靠右，与配置行最右的「更多」按钮图标同列对齐 */}
          <span className="flex size-7 shrink-0 items-center justify-center">
            <ChevronRight className="size-4 shrink-0" />
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60">
          {discovered.map((s) => (
            <RunnableRow
              key={s.name}
              label={s.name}
              rkey={scriptKey(s.projectPath, s.name)}
              target={{ type: 'script', projectPath: s.projectPath, name: s.name }}
              projectPath={s.projectPath}
              onAction={() => setOpen(false)}
            />
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SortableConfigRow({ config }: { config: RunConfig }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: config.id
  })
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative'
  }
  return (
    <div ref={setNodeRef} style={style} className="mb-0.5" {...attributes} {...listeners}>
      <RunnableRow
        label={config.kind === 'referenced' ? config.scriptName : config.name}
        rkey={configKey(config)}
        target={{ type: 'config', id: config.id }}
        projectPath={config.projectPath}
        config={config}
        indent
      />
    </div>
  )
}

function RunnableRow({
  label,
  rkey,
  target,
  projectPath,
  config,
  indent,
  onAction
}: {
  label: string
  rkey: string
  target: RunTarget
  projectPath: string
  config?: RunConfig
  indent?: boolean
  /** 选中或运行后回调（探测脚本弹出菜单用它及时关闭） */
  onAction?: () => void
}): React.JSX.Element {
  const status = useApp((s) => s.sessions[rkey]?.status ?? 'idle')
  const selected = useApp((s) => s.selectedKey === rkey)
  const run = useApp((s) => s.run)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)
  const selectScript = useApp((s) => s.selectScript)
  const running = status === 'running'
  // 选中蓝底行上的按钮 hover 用蓝色高亮，而非灰色。
  const btnHover = selected
    ? 'hover:bg-[var(--selection-row-hover)]'
    : 'hover:bg-[var(--bg-button-hover)]'
  // 空闲时按钮仅 hover / 选中才显示；运行中的重跑与停止恒显。
  const idleVis = selected ? 'flex' : 'hidden group-hover:flex'

  return (
    <div
      className={cn(ROW, selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]')}
      onClick={() => {
        onAction?.()
        // 探测脚本选中即晋升进「我的配置」，不必等运行。
        if (target.type === 'script') selectScript(target.projectPath, target.name, rkey)
        else select(rkey, projectPath)
      }}
    >
      {/* 缩进对齐：占位补齐折叠箭头列，点居中于文件夹图标列 */}
      {indent && <span className="size-4 shrink-0" />}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <StatusDot status={status} />
      </span>
      <span className="flex-1 truncate">{label}</span>

      {/* 左：运行 / 重新运行（恒在左，激活即原地替换） */}
      <button
        type="button"
        title={running ? '重新运行' : '运行'}
        className={cn(
          BTN,
          running
            ? 'bg-[var(--run-active-bg)] text-white hover:bg-[var(--run-active-bg-hover)]'
            : cn('text-[var(--run-glyph)]', btnHover, idleVis)
        )}
        onClick={(e) => {
          e.stopPropagation()
          onAction?.()
          run(target, rkey, projectPath)
        }}
      >
        {running ? <RotateCw className="size-4" /> : <Play className="size-4" />}
      </button>

      {/* 右：空闲=更多菜单（仅配置）/ 运行中=停止 */}
      {running ? (
        <button
          type="button"
          title="停止"
          className={cn(
            BTN,
            'bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)]'
          )}
          onClick={(e) => {
            e.stopPropagation()
            stop(rkey)
          }}
        >
          <Square className="size-4" />
        </button>
      ) : (
        config && (
          <MoreMenu
            config={config}
            baseClass={cn(BTN, 'text-muted-foreground hover:text-[color:var(--fg-icon)]', btnHover)}
            idleVis={idleVis}
          />
        )
      )}
    </div>
  )
}

function MoreMenu({
  config,
  baseClass,
  idleVis
}: {
  config: RunConfig
  baseClass: string
  idleVis: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const openEditDialog = useApp((s) => s.openEditDialog)
  const deleteConfig = useApp((s) => s.deleteConfig)

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <DropdownMenuTrigger
        className={cn(baseClass, open ? 'flex' : idleVis)}
        title="更多"
        onClick={(e) => e.stopPropagation()}
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {config.kind === 'command' && (
          <DropdownMenuItem onClick={() => openEditDialog(config)}>
            <Pencil className="size-4" /> 编辑
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => deleteConfig(config.id)}>
          <Trash2 className="size-4" /> 删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectMoreMenu({
  projectPath,
  selected
}: {
  projectPath: string
  selected?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const removeProject = useApp((s) => s.removeProject)

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <DropdownMenuTrigger
        className={cn(
          BTN,
          'text-muted-foreground hover:text-[color:var(--fg-icon)]',
          // 选中（蓝底）行上的按钮 hover 用蓝色高亮，而非灰色。
          selected ? 'hover:bg-[var(--selection-row-hover)]' : 'hover:bg-[var(--bg-button-hover)]',
          open ? 'flex' : 'hidden group-hover:flex'
        )}
        title="更多"
        onClick={(e) => e.stopPropagation()}
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => removeProject(projectPath)}>
          <Trash2 className="size-4" /> 移除项目
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function IconButton({
  title,
  onClick,
  selected,
  children
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  selected?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'hidden size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-[color:var(--fg-icon)] group-hover:flex',
        // 选中（蓝底）行上的按钮 hover 用蓝色高亮，而非灰色。
        selected ? 'hover:bg-[var(--selection-row-hover)]' : 'hover:bg-[var(--bg-button-hover)]'
      )}
    >
      {children}
    </button>
  )
}

const STATUS_COLOR: Record<SessionStatus | 'idle', string> = {
  idle: 'var(--status-idle)',
  running: 'var(--status-running)',
  exited: 'var(--status-success)',
  failed: 'var(--status-failed)'
}

function StatusDot({ status }: { status: SessionStatus | 'idle' }): React.JSX.Element {
  return (
    <span
      className="size-2 shrink-0 rounded-full transition-colors"
      style={{ background: STATUS_COLOR[status] }}
    />
  )
}
