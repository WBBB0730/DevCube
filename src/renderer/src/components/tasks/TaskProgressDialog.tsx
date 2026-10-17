// 进度弹窗：Task 在前台的样子（docs/prd/task-progress.md）。Git 的拉取、推送等挂在它的 Git Tab 里，克隆挂在应用根上。
// 「隐藏」为主按钮（回车即它），Esc 也是隐藏，点遮罩不收口；「取消」要明确点。发起后 300ms 才出现（同 WebStorm），
// 此前做完的不弹。
import { useRef } from 'react'
import { taskBarValue, taskDetailStats, taskPhaseLabel, type TaskInfo } from '@shared/task'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { DialogFooter } from '@renderer/components/ui/form-dialog'
import { ProgressBar, ProgressDetail } from '@renderer/components/ui/progress'
import { useShowSince } from '@renderer/lib/use-show-after'

/** 发起后多久才弹出进度弹窗。 */
const APPEAR_DELAY_MS = 300

/** 标题：「正在」+ 动作 + 等宽对象（单行截断，悬停全文）。任务清单的行用同一套，只是不带「正在」。 */
export function TaskTitleText({
  task,
  running = false
}: {
  task: TaskInfo
  running?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0">
        {running ? '正在' : ''}
        {task.title.action}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={task.title.target}>
        {task.title.target}
      </span>
    </div>
  )
}

export function TaskProgressDialog({
  task,
  appearDelay = APPEAR_DELAY_MS,
  onHide
}: {
  task: TaskInfo
  /** 克隆对话框里由填写态原地切过来，传 0 */
  appearDelay?: number
  onHide: () => void
}): React.JSX.Element | null {
  const hideRef = useRef<HTMLButtonElement>(null)
  const shown = useShowSince(task.createdAt, appearDelay)
  if (!shown && appearDelay > 0) return null
  const percent = task.status === 'queued' ? null : task.progress.percent

  return (
    <Dialog onClose={onHide} initialFocus={() => hideRef.current}>
      <div className="space-y-3 px-4 py-4">
        <div className="select-text text-[13px] leading-relaxed text-foreground">
          <TaskTitleText task={task} running />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span className="min-w-0 truncate">{taskPhaseLabel(task)}</span>
            {percent !== null && <span className="shrink-0 font-mono">{Math.floor(percent)}%</span>}
          </div>
          <ProgressBar value={taskBarValue(task)} />
        </div>
      </div>
      <DialogFooter>
        {/* 进度明细放在底栏左侧：与按钮同一行，没有数字的阶段左边空着，弹窗不多占一行 */}
        <ProgressDetail stats={taskDetailStats(task)} className="mr-auto min-w-0 self-center" />
        <Button
          variant="ghost"
          disabled={!task.cancellable}
          title={task.cancelBlockedReason ?? undefined}
          onClick={() => void window.api.cancelTask(task.id)}
        >
          取消
        </Button>
        <Button ref={hideRef} onClick={onHide}>
          隐藏
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
