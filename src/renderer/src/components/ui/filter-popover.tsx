// 带筛选框的下拉弹层（Git 顶栏的分支筛选、工作树、仓库三个下拉共用，版式见 DESIGN.md「Git 图谱」）：顶部筛选框 + 列表，
// 列表最大高 ≈ 参考实现的 297px（toolbar-widgets §2.3），超出滚动。打开即清空筛选词、筛选框自动聚焦；筛选只影响显示，
// 没有可显示的行时写「未找到结果。」。触发钮与列表行由调用方给：显示当前值的触发钮用 FILTER_SELECT_TRIGGER，行用 FILTER_ROW。
import { Popover, PopoverContent } from '@renderer/components/ui/popover'
import { TOOLBAR_SELECT } from '@renderer/components/ui/toolbar'
import { cn } from '@renderer/lib/utils'

/** 显示当前值的触发钮（配 PopoverTrigger）：宽随内容，最小 138px、最大 30vw */
export const FILTER_SELECT_TRIGGER = cn(TOOLBAR_SELECT, 'min-w-[138px] max-w-[30vw]')

/** 列表行：28px、13px，hover 底色带过渡（同左树行） */
export const FILTER_ROW =
  'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-1.5 text-[13px] transition-colors hover:bg-[var(--bg-row-hover)]'

/** 筛选词是否命中任一文字（不分大小写）；没有筛选词时一律命中。 */
export function matchesFilter(filter: string, ...texts: string[]): boolean {
  if (filter === '') return true
  const lower = filter.toLowerCase()
  return texts.some((text) => text.toLowerCase().includes(lower))
}

export function FilterPopover({
  open,
  onOpenChange,
  filter,
  onFilterChange,
  placeholder,
  trigger,
  empty,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filter: string
  onFilterChange: (filter: string) => void
  placeholder: string
  /** 触发钮（PopoverTrigger） */
  trigger: React.ReactNode
  /** 筛选后没有可显示的行 */
  empty: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (o) onFilterChange('')
      }}
    >
      {trigger}
      <PopoverContent className="max-h-none w-72 overflow-hidden p-0">
        <div className="border-b border-[color:var(--separator)] p-1.5">
          <input
            autoFocus
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={placeholder}
            className="h-7 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] px-2 text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="max-h-[297px] overflow-y-auto p-1.5">
          {children}
          {empty && (
            <div className="px-1.5 py-1 text-[13px] text-muted-foreground">未找到结果。</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
