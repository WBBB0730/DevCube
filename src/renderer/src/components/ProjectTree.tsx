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
  Trash2,
  X
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
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
import { Button } from '@renderer/components/ui/button'
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
const ROW = 'group flex h-10 cursor-pointer items-center gap-1.5 rounded px-1.5'
const BTN = 'flex size-7 shrink-0 items-center justify-center rounded-lg'

export function ProjectTree(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const addProject = useApp((s) => s.addProject)
  const addProjectByPath = useApp((s) => s.addProjectByPath)

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
        <span className="text-[11px] font-medium uppercase tracking-wide">项目</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="添加项目"
          onClick={addProject}
        >
          <FolderPlus className="size-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-auto px-1 py-1">
        {tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有项目，点上方 + 或把文件夹拖进来
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
  const removeProject = useApp((s) => s.removeProject)
  const openCreateDialog = useApp((s) => s.openCreateDialog)
  const reorderConfigs = useApp((s) => s.reorderConfigs)
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
    <div className="mb-1.5">
      <div
        className={cn(ROW, 'text-foreground hover:bg-[var(--bg-row-hover)]')}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.project.name}</span>
        {node.packageManager && (
          <span className="text-[11px] text-muted-foreground group-hover:hidden">
            {node.packageManager}
          </span>
        )}
        <IconButton
          title="新建命令"
          onClick={(e) => {
            e.stopPropagation()
            openCreateDialog(node.project.path)
          }}
        >
          <Plus className="size-4" />
        </IconButton>
        <IconButton
          title="移除项目"
          onClick={(e) => {
            e.stopPropagation()
            removeProject(node.project.path)
          }}
        >
          <X className="size-4" />
        </IconButton>
      </div>
      {open && (
        <div className="mt-0.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
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
            <div className="py-0.5 pl-9 text-[11px] text-[var(--fg-disabled)]">无可运行项</div>
          )}
          {node.discovered.length > 0 && <DiscoveredMenu discovered={node.discovered} />}
        </div>
      )}
    </div>
  )
}

// 探测脚本收进一个临时弹出菜单（Base UI Popover），菜单项与配置行同款样式。
function DiscoveredMenu({ discovered }: { discovered: DiscoveredScript[] }): React.JSX.Element {
  return (
    <div className="mt-0.5">
      <Popover>
        <PopoverTrigger
          className={cn(ROW, 'w-full text-muted-foreground hover:bg-[var(--bg-row-hover)]')}
        >
          {/* 占位补齐折叠箭头列；数字放在圆点列，与配置的状态点对齐 */}
          <span className="size-4 shrink-0" />
          <span className="flex size-4 shrink-0 items-center justify-center text-[11px] text-[var(--fg-disabled)]">
            {discovered.length}
          </span>
          <span className="flex-1 truncate text-left">检测到的配置</span>
          <ChevronRight className="size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverContent className="w-60 px-1">
          {discovered.map((s) => (
            <RunnableRow
              key={s.name}
              label={s.name}
              rkey={scriptKey(s.projectPath, s.name)}
              target={{ type: 'script', projectPath: s.projectPath, name: s.name }}
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
  config,
  indent
}: {
  label: string
  rkey: string
  target: RunTarget
  config?: RunConfig
  indent?: boolean
}): React.JSX.Element {
  const status = useApp((s) => s.sessions[rkey]?.status ?? 'idle')
  const selected = useApp((s) => s.selectedKey === rkey)
  const run = useApp((s) => s.run)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)
  const running = status === 'running'
  // 选中蓝底行上的按钮 hover 用蓝色高亮，而非灰色。
  const btnHover = selected
    ? 'hover:bg-[var(--selection-row-hover)]'
    : 'hover:bg-[var(--bg-button-hover)]'

  return (
    <div
      className={cn(ROW, selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]')}
      onClick={() => select(rkey)}
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
            : cn('text-[var(--run-glyph)]', btnHover)
        )}
        onClick={(e) => {
          e.stopPropagation()
          run(target, rkey)
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
          <MoreMenu config={config} triggerClass={cn(BTN, 'text-muted-foreground', btnHover)} />
        )
      )}
    </div>
  )
}

function MoreMenu({
  config,
  triggerClass
}: {
  config: RunConfig
  triggerClass: string
}): React.JSX.Element {
  const openEditDialog = useApp((s) => s.openEditDialog)
  const deleteConfig = useApp((s) => s.deleteConfig)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClass}
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

function IconButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="hidden size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-[var(--bg-button-hover)] group-hover:flex"
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
    <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />
  )
}
