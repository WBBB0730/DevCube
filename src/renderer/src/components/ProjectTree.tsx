import { useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RotateCw,
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
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type {
  DiscoveredScript,
  ProjectNode,
  RunConfig,
  RunTarget,
  SessionStatus
} from '@shared/types'
import { configKey, scriptKey } from '@shared/runnable'
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

// 列表仅垂直排序，且钳制在本项目配置列表块内（containerNodeRect 即被拖行的父容器）。
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

export function ProjectTree(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const addProject = useApp((s) => s.addProject)
  const addProjectByPath = useApp((s) => s.addProjectByPath)
  const createProject = useApp((s) => s.createProject)

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
      <header className="flex h-10 items-center justify-between pl-3 pr-2 text-muted-foreground">
        <span className="text-[12px] font-medium uppercase tracking-wide">项目</span>
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
      <div className="flex-1 overflow-auto px-1.5 pb-1.5">
        {tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            拖入文件夹，或点上方 + 新建 / 添加项目
          </p>
        ) : (
          tree.map((node) => <ProjectRow key={node.project.path} node={node} />)
        )}
      </div>
    </div>
  )
}

function ProjectRow({ node }: { node: ProjectNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const reorderConfigs = useApp((s) => s.reorderConfigs)
  const selectProject = useApp((s) => s.selectProject)
  // 与配置行同层级的互斥选中：仅当「项目本身」被选中（无可运行项选中）时高亮项目行。
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

  const empty = node.configs.length === 0 && node.discovered.length === 0

  return (
    <div className="mb-3 last:mb-0">
      <div
        className={cn(
          ROW,
          'select-none text-foreground',
          selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]'
        )}
        onClick={() => selectProject(node.project.path)}
        onDoubleClick={() => setOpen((v) => !v)}
      >
        {/* 折叠/展开由箭头或整行双击触发（整行单击留给「设为当前项目」）。 */}
        <button
          type="button"
          title={open ? '折叠' : '展开'}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
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
      {open && (
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
          {empty && (
            <div className="py-0.5 pl-9 text-[12px] text-[var(--fg-disabled)]">无可运行项</div>
          )}
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
    transform: CSS.Transform.toString(transform),
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
