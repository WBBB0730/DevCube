// 进度条与进度明细（docs/prd/task-progress.md）：Task 的进度弹窗、任务清单、「关于」页的更新下载共用。
// 进度条建在 Base UI Progress 上：有百分比按百分比填充（宽度过渡），null 为不确定（一段来回滑过）。
import { Progress } from '@base-ui-components/react/progress'
import { progressDetail } from '@shared/task'
import { cn } from '@renderer/lib/utils'

/** 高 4px、全圆角；value 为 0–100，null 为不确定。等待中传 0：轨道空着、不动。 */
export function ProgressBar({
  value,
  className
}: {
  value: number | null
  className?: string
}): React.JSX.Element {
  return (
    <Progress.Root value={value} className={cn('w-full', className)}>
      <Progress.Track className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--progress-track)]">
        {/* 不确定与按比例切换时重新挂载：两种状态的宽度与位置毫无关联，不能用宽度过渡接起来（否则滑块跳回左端再缩放） */}
        <Progress.Indicator
          key={value === null ? 'indeterminate' : 'determinate'}
          className="absolute h-full rounded-full bg-primary transition-[width] duration-150 data-[indeterminate]:w-[30%] data-[indeterminate]:animate-[progress-indeterminate_1.2s_ease-in-out_infinite]"
        />
      </Progress.Track>
    </Progress.Root>
  )
}

/**
 * 进度明细（12px muted、等宽数位）：「已传 X（速度）」，知道总量时「已传 X / 总量（速度）· 还剩」；label 为前面的字。
 * 不传数据的阶段留空占位：换阶段时所在的弹窗不变高变矮。
 */
export function ProgressDetail({
  stats,
  label,
  className
}: {
  stats: Parameters<typeof progressDetail>[0]
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'h-4 truncate text-[12px] leading-4 tabular-nums text-muted-foreground',
        className
      )}
    >
      {progressDetail(stats, label)}
    </div>
  )
}
