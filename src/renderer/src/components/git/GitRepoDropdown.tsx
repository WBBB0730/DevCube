// Git Tab 工具栏的仓库下拉（docs/prd/git-nested-repos.md）：切换 Git Tab 显示项目里的哪个仓库。触发钮同分支下拉
// （显示当前值的下拉钮），弹层同款——顶部筛选框、同款列表行；项目自己的仓库排第一个，其后是嵌套仓库与子模块，
// 选中的行打 ✓，悬停看完整路径。项目根不是仓库时最上面多一行「初始化 Git 仓库…」（在项目根初始化，与非仓库页的
// 按钮同一个对话框）。项目里只有它自己这一个仓库时整颗不渲染（showsRepoPicker）。
import { useState } from 'react'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { showsRepoPicker } from '@shared/git'
import { useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { TOOLBAR_SELECT } from '@renderer/components/ui/toolbar'

// 触发钮宽度随内容，上下限同分支下拉
const TRIGGER = cn(TOOLBAR_SELECT, 'min-w-[138px] max-w-[30vw]')
// 列表行照分支下拉
const ROW =
  'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-1.5 text-[13px] transition-colors hover:bg-[var(--bg-row-hover)]'
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
  const lower = filterText.toLowerCase()
  const initVisible = !hasOwn && (filterText === '' || INIT_LABEL.includes(filterText))
  const shown =
    filterText === ''
      ? repos.list
      : repos.list.filter((r) => [r.name, r.root].some((t) => t.toLowerCase().includes(lower)))

  const init = (): void => {
    setOpen(false)
    // 预填当前生效的 init.defaultBranch（未配置回落 main），拿到后再弹对话框
    void window.api.gitDefaultBranch(projectPath).then((defaultBranch) => {
      useGit.getState().openDialog(projectPath, { kind: 'init', defaultBranch })
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setFilterText('') // 打开即清空过滤词（同分支下拉），输入框 autoFocus 聚焦
      }}
    >
      <PopoverTrigger className={TRIGGER} title={current?.root}>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
          {current?.name}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="max-h-none w-72 overflow-hidden p-0">
        <div className="border-b border-[color:var(--separator)] p-1.5">
          <input
            autoFocus
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="筛选仓库…"
            className="h-7 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] px-2 text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {/* 菜单最大高度同分支下拉（≈ 297px），超出滚动 */}
        <div className="max-h-[297px] overflow-y-auto p-1.5">
          {initVisible && (
            <div className={ROW} onClick={init}>
              <Plus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {INIT_LABEL}…
              </span>
            </div>
          )}
          {shown.map((repo) => (
            <div
              key={repo.path}
              className={ROW}
              title={repo.root}
              onClick={() => {
                setOpen(false)
                selectRepo(projectPath, repo.path)
              }}
            >
              <Check
                className={cn('size-3.5 shrink-0', repo.path !== repos.selected && 'invisible')}
              />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {repo.name}
              </span>
            </div>
          ))}
          {!initVisible && shown.length === 0 && (
            <div className="px-1.5 py-1 text-[13px] text-muted-foreground">未找到结果。</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
