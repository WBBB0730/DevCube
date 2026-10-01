// 表格底部的分页器（docs/prd/database.md「分页」）：上一页、下一页、页码（可直接输入跳页）、每页行数
// （可直接输入，旁边的小钮列出几个常用值）、总行数（还在数时显示说明）。
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { NumberInput } from '@renderer/components/ui/number-input'
import { TOOLBAR_BTN, TOOLBAR_BTN_SM } from '@renderer/components/ui/toolbar'
import { cn } from '@renderer/lib/utils'
import { isPageSize, PAGE_SIZE_PRESETS } from '@shared/data-source-query'

export function Paginator({
  page,
  pageSize,
  pageRows,
  total,
  totalHint,
  disabled = false,
  onPage,
  onPageSize
}: {
  /** 从 0 开始的页码 */
  page: number
  pageSize: number
  /** 当前页的行数（总行数未知时据此判断是不是最后一页） */
  pageRows: number
  /** 总行数；还不知道时为 null，旁边显示 totalHint */
  total: number | null
  totalHint?: string
  disabled?: boolean
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}): React.JSX.Element {
  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize))
  const hasNext = pages === null ? pageRows >= pageSize : page + 1 < pages
  const commitPageSize = (size: number): void => {
    if (isPageSize(size) && size !== pageSize) onPageSize(size)
  }
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-t border-[var(--separator)] bg-panel px-2 text-[13px] text-muted-foreground">
      <button
        type="button"
        title="上一页"
        className={TOOLBAR_BTN}
        disabled={disabled || page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span>第</span>
      <NumberInput
        value={page + 1}
        title="页码"
        className="w-12"
        onCommit={(n) => {
          const valid = Number.isInteger(n) && n >= 1 && (pages === null || n <= pages)
          if (valid && n - 1 !== page) onPage(n - 1)
        }}
      />
      <span>页{pages === null ? '' : ` / ${pages}`}</span>
      <button
        type="button"
        title="下一页"
        className={TOOLBAR_BTN}
        disabled={disabled || !hasNext}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-4" />
      </button>
      <span className="ml-3">每页</span>
      <NumberInput value={pageSize} title="每页行数" className="w-16" onCommit={commitPageSize} />
      <DropdownMenu>
        <DropdownMenuTrigger title="常用的每页行数" className={TOOLBAR_BTN_SM}>
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PAGE_SIZE_PRESETS.map((size) => (
            <DropdownMenuItem key={size} onClick={() => commitPageSize(size)}>
              <Check className={cn('size-3.5 shrink-0', size !== pageSize && 'invisible')} />
              {size}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span>行</span>
      <span className="ml-3 min-w-0 truncate" title={total === null ? totalHint : undefined}>
        {total === null ? totalHint : `共 ${total.toLocaleString()} 行`}
      </span>
    </div>
  )
}
