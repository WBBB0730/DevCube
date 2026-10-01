// 工作表标签式的切换（Excel 预览底部的工作表标签、数据源 Tab 顶栏的「当前对象 | 控制台」共用）：一排无外框的文字钮，
// 每项 h-6 圆角、13px，名字过长截断（悬停看全名）；选中为 `--selection-row` 底 + 正文色，其余 muted、悬停压行底。
// 所在栏的高度、边框与滚动由调用方经 className 给。
import { cn } from '@renderer/lib/utils'

export function SheetTabs<T extends string>({
  items,
  value,
  onValueChange,
  className
}: {
  items: readonly { value: T; label: string }[]
  value: T
  onValueChange: (value: T) => void
  /** 外层补充样式（所在栏的高度、边框、滚动等） */
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          title={item.label}
          className={cn(
            'h-6 max-w-48 shrink-0 truncate rounded px-2 text-[13px] transition-colors',
            item.value === value
              ? 'bg-[var(--selection-row)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--bg-row-hover)] hover:text-foreground'
          )}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
