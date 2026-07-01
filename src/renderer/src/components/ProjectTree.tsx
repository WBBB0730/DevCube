import { useState } from 'react'
import { ChevronRight, Folder, Plus, X } from 'lucide-react'
import type { ProjectNode } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { useApp } from '@renderer/store'

export function ProjectTree(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const addProject = useApp((s) => s.addProject)

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-panel">
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
              <ItemRow key={s.name} label={s.name} />
            ))}
          </Group>
          <Group label="我的配置" empty={node.configs.length === 0}>
            {node.configs.map((c) => (
              <ItemRow key={c.id} label={c.kind === 'referenced' ? c.scriptName : c.name} />
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
  children
}: {
  label: string
  empty: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="py-0.5">
      <div className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {empty ? (
        <div className="px-2 py-0.5 text-[11px] text-[var(--fg-disabled)]">—</div>
      ) : (
        children
      )}
    </div>
  )
}

function ItemRow({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex h-6 items-center gap-1.5 px-1.5 hover:bg-[var(--bg-row-hover)]">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--status-idle)]" />
      <span className="flex-1 truncate">{label}</span>
    </div>
  )
}
