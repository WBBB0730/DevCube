import { useState } from 'react'
import { ChevronRight, Folder, Pencil, Play, Plus, RotateCw, Square, Trash2, X } from 'lucide-react'
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
import type { ProjectNode, RunConfig, RunTarget, SessionStatus } from '@shared/types'
import { configKey, scriptKey } from '@shared/runnable'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { useApp } from '@renderer/store'

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
      <header className="flex h-9 items-center justify-between pl-3 pr-2 text-muted-foreground">
        <span className="text-[11px] font-medium uppercase tracking-wide">项目</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="添加项目"
          onClick={addProject}
        >
          <Plus className="size-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-auto py-1">
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

  return (
    <div>
      <div
        className="group flex h-7 cursor-pointer items-center gap-1 px-2 text-foreground hover:bg-[var(--bg-row-hover)]"
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
        <button
          type="button"
          title="移除项目"
          className="hidden size-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-button-hover)] group-hover:flex"
          onClick={(e) => {
            e.stopPropagation()
            removeProject(node.project.path)
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      {open && (
        <div className="pl-4">
          <Group
            label="我的配置"
            empty={node.configs.length === 0}
            onAdd={() => openCreateDialog(node.project.path)}
          >
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
          </Group>
          <Group label="探测脚本" empty={node.discovered.length === 0}>
            {node.discovered.map((s) => (
              <RunnableRow
                key={s.name}
                label={s.name}
                rkey={scriptKey(s.projectPath, s.name)}
                target={{ type: 'script', projectPath: s.projectPath, name: s.name }}
              />
            ))}
          </Group>
        </div>
      )}
    </div>
  )
}

function Group({
  label,
  empty,
  onAdd,
  children
}: {
  label: string
  empty: boolean
  onAdd?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="group/g py-0.5">
      <div className="flex h-7 items-center justify-between px-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {onAdd && (
          <button
            type="button"
            title="新建命令"
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-[var(--bg-button-hover)] group-hover/g:opacity-100"
            onClick={onAdd}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {empty ? (
        <div className="px-2.5 py-0.5 text-[11px] text-[var(--fg-disabled)]">—</div>
      ) : (
        children
      )}
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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <RunnableRow
        label={config.kind === 'referenced' ? config.scriptName : config.name}
        rkey={configKey(config)}
        target={{ type: 'config', id: config.id }}
        config={config}
      />
    </div>
  )
}

function RunnableRow({
  label,
  rkey,
  target,
  config
}: {
  label: string
  rkey: string
  target: RunTarget
  config?: RunConfig
}): React.JSX.Element {
  const status = useApp((s) => s.sessions[rkey]?.status ?? 'idle')
  const selected = useApp((s) => s.selectedKey === rkey)
  const run = useApp((s) => s.run)
  const stop = useApp((s) => s.stop)
  const select = useApp((s) => s.select)
  const openEditDialog = useApp((s) => s.openEditDialog)
  const deleteConfig = useApp((s) => s.deleteConfig)
  const running = status === 'running'
  // 选中蓝底行上的按钮 hover 用蓝色高亮，而非灰色。
  const btnHover = selected
    ? 'hover:bg-[var(--selection-row-hover)]'
    : 'hover:bg-[var(--bg-button-hover)]'

  return (
    <div
      className={cn(
        'group mx-1 flex h-7 cursor-pointer items-center gap-1.5 rounded px-2',
        selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]'
      )}
      onClick={() => select(rkey)}
    >
      <StatusDot status={status} />
      <span className="flex-1 truncate">{label}</span>
      {!running && config?.kind === 'command' && (
        <IconButton
          title="编辑"
          hoverClass={btnHover}
          onClick={(e) => {
            e.stopPropagation()
            openEditDialog(config)
          }}
        >
          <Pencil className="size-4" />
        </IconButton>
      )}
      {!running && config && (
        <IconButton
          title="删除配置"
          hoverClass={btnHover}
          onClick={(e) => {
            e.stopPropagation()
            deleteConfig(config.id)
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      )}
      <button
        type="button"
        title={running ? '重新运行' : '运行'}
        className={cn(
          'size-6 items-center justify-center rounded',
          running
            ? 'flex bg-[var(--run-active-bg)] text-white hover:bg-[var(--run-active-bg-hover)]'
            : cn('text-[var(--run-glyph)]', btnHover, selected ? 'flex' : 'hidden group-hover:flex')
        )}
        onClick={(e) => {
          e.stopPropagation()
          run(target, rkey)
        }}
      >
        {running ? <RotateCw className="size-4" /> : <Play className="size-4" />}
      </button>
      {running && (
        <button
          type="button"
          title="停止"
          className="flex size-6 items-center justify-center rounded bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)]"
          onClick={(e) => {
            e.stopPropagation()
            stop(rkey)
          }}
        >
          <Square className="size-3.5" />
        </button>
      )}
    </div>
  )
}

function IconButton({
  title,
  hoverClass,
  onClick,
  children
}: {
  title: string
  hoverClass: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'hidden size-6 items-center justify-center rounded text-muted-foreground group-hover:flex',
        hoverClass
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
    <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />
  )
}
