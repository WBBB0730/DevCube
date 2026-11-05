// Git Tab 工具栏的仓库下拉（docs/prd/git-nested-repos.md）：切换 Git Tab 显示项目里的哪个仓库。触发钮同分支下拉
// （显示当前值的下拉钮），弹层同款——顶部筛选框、同款列表行；项目自己的仓库排第一个，其后是嵌套仓库与子模块，
// 选中的行打 ✓，悬停看完整路径。项目根不是仓库时最上面多一行「初始化 Git 仓库…」（在项目根初始化，与非仓库页的
// 按钮同一个对话框）。项目里只有它自己这一个仓库时整颗不渲染（showsRepoPicker）。
import { useState } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { showsRepoPicker } from '@shared/git'
import { openInitDialog, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { PopoverTrigger } from '@renderer/components/ui/popover'
import {
  FILTER_ROW,
  FILTER_SELECT_TRIGGER,
  FilterPopover,
  matchesFilter
} from '@renderer/components/ui/filter-popover'

const INIT_LABEL = '初始化 Git 仓库'

export function GitRepoDropdown({
  projectPath
}: {
  projectPath: string
}): React.JSX.Element | null {
  const repos = useGit((s) => s.projectRepos[projectPath])
  const selectRepo = useGit((s) => s.selectRepo)
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  if (repos === undefined || !showsRepoPicker(repos.list)) return null
  const current = repos.list.find((r) => r.path === repos.selected) ?? null
  const hasOwn = repos.list.some((r) => r.own)
  // 过滤只影响显示（同分支下拉）：按名字或路径命中；「初始化」行同样参与按名过滤
  const initVisible = !hasOwn && matchesFilter(filterText, INIT_LABEL)
  const shown = repos.list.filter((r) => matchesFilter(filterText, r.name, r.root))

  return (
    <FilterPopover
      open={open}
      onOpenChange={setOpen}
      filter={filterText}
      onFilterChange={setFilterText}
      placeholder="筛选仓库…"
      empty={!initVisible && shown.length === 0}
      trigger={
        <PopoverTrigger className={FILTER_SELECT_TRIGGER} title={current?.root}>
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
            {current?.name}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
      }
    >
      {initVisible && (
        <div
          className={FILTER_ROW}
          onClick={() => {
            setOpen(false)
            openInitDialog(projectPath)
          }}
        >
          <Plus className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {INIT_LABEL}…
          </span>
        </div>
      )}
      {shown.map((repo) => (
        <div
          key={repo.path}
          className={FILTER_ROW}
          title={repo.root}
          onClick={() => {
            setOpen(false)
            selectRepo(projectPath, repo.path)
          }}
        >
          <Check className={cn('size-3.5 shrink-0', repo.path !== repos.selected && 'invisible')} />
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {repo.name}
          </span>
        </div>
      ))}
    </FilterPopover>
  )
}
