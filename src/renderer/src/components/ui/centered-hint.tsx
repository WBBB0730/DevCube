// 正文区居中的提示（空页面、加载中、出错）：一行 muted 14px，撑满所在区域。
// 撑满：在 flex 列里按 flex-1 占满剩余，在普通容器里按 h-full；盖在正文上时由调用方补 `absolute inset-0` 与底色。
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useShowAfter } from '@renderer/lib/use-show-after'
import { cn } from '@renderer/lib/utils'

/** 加载提示延迟出现的常用取值：快的时候不闪（同 diff 加载骨架、Files 树顶首查扫描） */
export const LOADING_HINT_DELAY_MS = 120

export function CenteredHint({
  error = false,
  className,
  children
}: {
  /** 出错：前置 `--status-failed` 色的 CircleAlert；文字（出错原因）可选中，原样换行、居中 */
  error?: boolean
  /** 盖在正文上时补的定位与底色等，如 `absolute inset-0 bg-deepest` */
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 items-center justify-center gap-1.5 px-6 text-sm text-muted-foreground',
        error && 'select-text whitespace-pre-wrap break-words text-center',
        className
      )}
    >
      {error && <CircleAlert className="size-4 shrink-0 text-[color:var(--status-failed)]" />}
      {children}
    </div>
  )
}

/** 加载中：转圈 + 文案；挂载后过 delay 才出现（进入加载中时挂载），快的时候不闪 */
export function LoadingHint({
  label = '正在加载…',
  delay = LOADING_HINT_DELAY_MS,
  className
}: {
  label?: string
  /** 毫秒；0 即刻出现（如盖住旧内容的遮罩、外层已经延迟过） */
  delay?: number
  /** 同 CenteredHint */
  className?: string
}): React.JSX.Element | null {
  const shown = useShowAfter(delay)
  if (!shown) return null
  return (
    <CenteredHint className={className}>
      <LoaderCircle className="size-3.5 animate-spin" />
      {label}
    </CenteredHint>
  )
}
