// 提交检查的结果图标（docs/prd/github-checks.md）：图谱行上的检查汇总与提交详情里的各项检查共用。
// 通过为绿勾、失败为红叉、进行中为黄点、不算成败的（跳过 / 取消等）为灰色斜杠圈；没有检查不画。
import { Check, CircleSlash, X } from 'lucide-react'
import type { CheckRunState, CommitCheckState } from '@shared/github'
import { cn } from '@renderer/lib/utils'

/** 图谱行上图标的悬浮说明。 */
const ROLLUP_TITLE: Record<Exclude<CommitCheckState, 'none'>, string> = {
  success: '检查通过',
  failure: '检查失败',
  pending: '检查进行中'
}

export function GitCheckIcon({
  state,
  withTitle = false,
  className
}: {
  state: CommitCheckState | CheckRunState
  /** 带上检查汇总的悬浮说明（图谱行用；详情列表的每项已有名字） */
  withTitle?: boolean
  className?: string
}): React.JSX.Element | null {
  if (state === 'none') return null
  const title = withTitle && state !== 'neutral' ? ROLLUP_TITLE[state] : undefined
  const box = cn('flex size-3.5 shrink-0 items-center justify-center', className)
  switch (state) {
    case 'success':
      return (
        <span className={box} title={title}>
          <Check className="size-3.5 text-status-success" strokeWidth={2.5} />
        </span>
      )
    case 'failure':
      return (
        <span className={box} title={title}>
          <X className="size-3.5 text-status-failed" strokeWidth={2.5} />
        </span>
      )
    case 'pending':
      return (
        <span className={box} title={title}>
          <span className="size-2 rounded-full bg-status-pending" />
        </span>
      )
    case 'neutral':
      return (
        <span className={box}>
          <CircleSlash className="size-3 text-muted-foreground" />
        </span>
      )
  }
}
