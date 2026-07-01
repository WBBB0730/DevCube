import { useState } from 'react'
import { ChevronRight, Folder, Pencil, Play, Plus, RotateCw, Square, Trash2, X } from 'lucide-react'
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
      className="flex h-full w-full flex-col bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        for (const file of Array.from(e.dataTransfer.files)) {
          await addProjectByPath(window.drop.getPathForFile(file))
        }
      }}
    >
      <header className="flex h-8 items-center justify-between pl-3 pr-1.5 text-muted-foreground">
        <span className="text-[11px] font-medium uppercase tracking-wide">项目</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5"
          title="添加项目"
          onClick={addProject}
        >
          <Plus className="size-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-auto py-1">
        {tree.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有项目，点上方 + 添加一个文件夹
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

  return (
    <div>
      <div
        className="group flex h-6 cursor-pointer items-center gap-1 px-1.5 text-foreground hover:bg-[var(--bg-row-hover)]"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{node.project.name}</span>
        {node.packageManager && (
          <span className="text-[10px] text-muted-foreground group-hover:hidden">
            {node.packageManager}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-5 group-hover:flex"
          title="移除项目"
          onClick={(e) => {
            e.stopPropagation()
            removeProject(node.project.path)
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {open && (
        <div className="pl-4">
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
          <Group
            label="我的配置"
            empty={node.configs.length === 0}
            onAdd={() => openCreateDialog(node.project.path)}
          >
            {node.configs.map((c) => (
              <RunnableRow
                key={c.id}
                label={c.kind === 'referenced' ? c.scriptName : c.name}
                rkey={configKey(c)}
                target={{ type: 'config', id: c.id }}
                config={c}
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
      <div className="flex items-center justify-between px-1.5 py-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {onAdd && (
          <button
            type="button"
            title="新建命令"
            className="hidden size-4 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-button-hover)] group-hover/g:flex"
            onClick={onAdd}
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>
      {empty ? (
        <div className="px-2 py-0.5 text-[11px] text-[var(--fg-disabled)]">—</div>
      ) : (
        children
      )}
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

  return (
    <div
      className={cn(
        'group flex h-6 cursor-pointer items-center gap-1.5 px-1.5',
        selected ? 'bg-[var(--selection-row)]' : 'hover:bg-[var(--bg-row-hover)]'
      )}
      onClick={() => select(rkey)}
    >
      <StatusDot status={status} />
      <span className="flex-1 truncate">{label}</span>
      {!running && config?.kind === 'command' && (
        <IconButton
          title="编辑"
          onClick={(e) => {
            e.stopPropagation()
            openEditDialog(config)
          }}
        >
          <Pencil className="size-3.5" />
        </IconButton>
      )}
      {!running && config && (
        <IconButton
          title="删除配置"
          onClick={(e) => {
            e.stopPropagation()
            deleteConfig(config.id)
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
      <button
        type="button"
        title={running ? '重新运行' : '运行'}
        className={cn(
          'size-5 items-center justify-center rounded',
          running
            ? 'flex bg-[var(--run-active-bg)] text-white hover:bg-[var(--run-active-bg-hover)]'
            : cn(
                'text-[var(--run-glyph)] hover:bg-[var(--bg-button-hover)]',
                selected ? 'flex' : 'hidden group-hover:flex'
              )
        )}
        onClick={(e) => {
          e.stopPropagation()
          run(target, rkey)
        }}
      >
        {running ? <RotateCw className="size-3" /> : <Play className="size-3.5" />}
      </button>
      {running && (
        <button
          type="button"
          title="停止"
          className="flex size-5 items-center justify-center rounded bg-[var(--stop-active-bg)] text-white hover:bg-[var(--stop-active-bg-hover)]"
          onClick={(e) => {
            e.stopPropagation()
            stop(rkey)
          }}
        >
          <Square className="size-3" />
        </button>
      )}
    </div>
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
      className="hidden size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-button-hover)] group-hover:flex"
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
    <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />
  )
}
