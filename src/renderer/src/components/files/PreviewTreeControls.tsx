// Preview Window 专属的树顶栏控件（docs/prd/file-preview-window.md）：并入 Files 面板既有的树顶栏
// （筛选框 + 全部展开 / 折叠 / 隐藏），不另起一行：右侧钮组最左「按类型筛选」下拉多选（非全选时点亮）。
// 「上一级」在树空白区右键菜单（FilesTreeMenu），「添加为项目 / 转到项目」在窗口顶栏设置钮旁（PreviewWindow）。
// 主窗口 Files Tab 没有这些。视觉见 DESIGN.md「Preview Window」。
import { ListFilter } from 'lucide-react'
import {
  FILES_TYPE_CATEGORIES,
  FILES_TYPE_CATEGORY_LABELS,
  isFilesTypeFilterActive,
  type FilesTypeCategory
} from '@shared/files-type-filter'
import { cn } from '@renderer/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { TOOLBAR_BTN } from './FilesToolbar'

export const FILES_ALL_TYPES: ReadonlySet<FilesTypeCategory> = new Set(FILES_TYPE_CATEGORIES)

/** 树顶栏右侧钮组最左：按类型筛选下拉 */
export function PreviewTypeFilterButton({
  typeFilter,
  onTypeFilterChange
}: {
  typeFilter: ReadonlySet<FilesTypeCategory>
  onTypeFilterChange: (next: ReadonlySet<FilesTypeCategory>) => void
}): React.JSX.Element {
  const active = isFilesTypeFilterActive(typeFilter)
  const toggle = (cat: FilesTypeCategory, on: boolean): void => {
    const next = new Set(typeFilter)
    if (on) next.add(cat)
    else next.delete(cat)
    onTypeFilterChange(next)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="按类型筛选"
        className={cn(
          TOOLBAR_BTN,
          active && 'text-[color:var(--fg-primary)] hover:text-[color:var(--fg-primary)]'
        )}
      >
        <ListFilter className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FILES_TYPE_CATEGORIES.map((cat) => (
          <DropdownMenuCheckboxItem
            key={cat}
            checked={typeFilter.has(cat)}
            onCheckedChange={(on) => toggle(cat, on)}
          >
            {FILES_TYPE_CATEGORY_LABELS[cat]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onClick={() => onTypeFilterChange(FILES_ALL_TYPES)}>
          <span className="size-3.5 shrink-0" />
          全部
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
