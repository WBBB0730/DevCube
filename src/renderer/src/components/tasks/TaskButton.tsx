// 顶栏任务钮与任务清单（docs/prd/task-progress.md，仅主窗口）：只在有被隐藏的 Task 时出现。
// 钮上画被隐藏的进行中 Task 的平均总进度（圆环；都没有百分比时一段弧在转），有失败的换成红色警示。
// 点开清单逐项看进度、单独取消或关掉；点项即找回（放回眼前，和没隐藏过一样）。
import { useState } from 'react'
import { CircleAlert, X } from 'lucide-react'
import {
  progressDetail,
  taskBarValue,
  taskDetailStats,
  taskPhaseLabel,
  type TaskInfo
} from '@shared/task'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ProgressBar } from '@renderer/components/ui/progress'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'
import { revealTask, useHiddenTasks } from '@renderer/task-store'
import { TaskTitleText } from './TaskProgressDialog'

/** 16px 圆环：2px 描边，进度弧从 12 点钟方向顺时针；value 为 null 时一段 1/4 弧匀速旋转。 */
function ProgressRing({ value }: { value: number | null }): React.JSX.Element {
  const r = 6
  const circumference = 2 * Math.PI * r
  const arc = value === null ? circumference / 4 : (circumference * Math.min(100, value)) / 100
  return (
    <svg viewBox="0 0 16 16" className={cn('size-4 -rotate-90', value === null && 'animate-spin')}>
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        className="stroke-[var(--progress-track)]"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference}`}
        className="stroke-primary transition-[stroke-dasharray] duration-150"
      />
    </svg>
  )
}

/** 钮上的总进度：被隐藏的进行中 Task 的平均百分比（没有百分比的不计入）；都没有为 null。 */
function ringValue(tasks: TaskInfo[]): number | null {
  const percents = tasks.flatMap((t) =>
    t.status === 'running' && t.progress.percent !== null ? [t.progress.percent] : []
  )
  return percents.length === 0 ? null : percents.reduce((sum, p) => sum + p, 0) / percents.length
}

export function TaskButton({ className }: { className: string }): React.JSX.Element | null {
  const hidden = useHiddenTasks()
  const [open, setOpen] = useState(false)
  if (hidden.length === 0) return null
  const failed = hidden.filter((t) => t.status === 'failed').length
  const title = failed > 0 ? `${hidden.length} 个任务，${failed} 个失败` : `${hidden.length} 个任务`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger title={title} className={className}>
        {failed > 0 ? (
          <CircleAlert className="size-4 text-[color:var(--status-failed)]" />
        ) : (
          <ProgressRing value={ringValue(hidden)} />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[464px] w-80 p-1">
        {hidden.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onReveal={() => {
              setOpen(false)
              revealTask(task)
            }}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** 清单里的一项：标题 + 行尾取消 / 关闭；所属项目；进度条 + 明细，失败的为原因。点项即找回。 */
function TaskRow({ task, onReveal }: { task: TaskInfo; onReveal: () => void }): React.JSX.Element {
  const projectName = useApp((s) =>
    task.kind === 'git'
      ? (s.tree.find((n) => n.project.path === task.projectPath)?.project.name ?? null)
      : null
  )
  const failed = task.status === 'failed'
  const percent = task.status === 'running' ? task.progress.percent : null
  // 进度明细：阶段 · 百分比 · 已传（速度）
  const detail = [
    taskPhaseLabel(task),
    percent === null ? null : `${Math.floor(percent)}%`,
    progressDetail(taskDetailStats(task))
  ]
    .filter((part) => part !== null)
    .join(' · ')
  const reason = task.errors.filter((e) => e !== '').join('\n')

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-default flex-col gap-1 rounded px-2 py-1.5 outline-none hover:bg-[var(--bg-row-hover)] focus-visible:bg-[var(--bg-row-hover)]"
      onClick={onReveal}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onReveal()
      }}
    >
      <div className="flex items-center gap-2 text-[13px] text-foreground">
        <div className="min-w-0 flex-1">
          <TaskTitleText task={task} />
        </div>
        <button
          type="button"
          title={failed ? '关闭' : (task.cancelBlockedReason ?? '取消')}
          disabled={!failed && !task.cancellable}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation()
            void (failed ? window.api.dismissTask(task.id) : window.api.cancelTask(task.id))
          }}
        >
          <X className="size-3" />
        </button>
      </div>
      {projectName !== null && (
        <div className="truncate text-[12px] text-muted-foreground">{projectName}</div>
      )}
      {failed ? (
        <div
          className="line-clamp-2 whitespace-pre-wrap break-all text-[12px] text-[color:var(--status-failed)]"
          title={reason}
        >
          {reason || '操作失败'}
        </div>
      ) : (
        <>
          <ProgressBar value={taskBarValue(task)} className="mt-0.5" />
          <div className="truncate text-[12px] tabular-nums text-muted-foreground">{detail}</div>
        </>
      )}
    </div>
  )
}
