// Git Tab 工具栏的工作树入口：图标钮（FolderGit2，同视图选项钮观感）弹出与分支下拉同款的
// 弹层——同宽、顶部筛选框、同款列表行。列出同仓库的全部工作树（`git worktree list` 序；
// 主工作树显示「主工作树」、本项目那行打 ✓、行尾灰字为其分支或短 hash、目录已不存在的行
// 半透明不可点），点其他行 = 前往其 Project——未登记则先登记（addProjectByPath，与
// External Open 同一收尾）。管理入口：顶部「新建工作树…」行；行悬停出尾钮——可删的行
// 删除（主工作树与本项目无）、失效行清理登记；三者都只打开对话框（GitDialogs D31–D33）。
// 仓库无工作树数据时整颗不渲染。
import { useState } from 'react'
import { Check, Eraser, FolderGit2, Plus, Trash2 } from 'lucide-react'
import { listedWorktrees, worktreeDisplayName, type GitWorktree } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { useApp } from '@renderer/store'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { abbrevHash } from './git-format'

// 图标钮：观感对齐工具栏其它图标钮（size-7 圆角 hover 加亮）；列表行照分支下拉，hover 底色带过渡（同左树行）
const ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'
const ROW =
  'group relative flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-1.5 text-[13px] transition-colors hover:bg-[var(--bg-row-hover)]'
// 行尾操作钮：绝对定位盖在行尾，不占布局（分支名平时贴右缘，悬停不被顶开）；行悬停时钮渐显、
// 被盖住的行尾灰字同步渐隐（opacity 过渡）。右 / 上 / 下边距同为 2px（行 28px、钮 24px）
const ROW_BTN =
  'absolute right-0.5 top-0.5 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] group-hover:opacity-100'
/** 行尾灰字：有钮的行悬停时渐隐让位（钮盖在它上面） */
const REF_TEXT =
  'max-w-[45%] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted-foreground transition-opacity'

/** 行尾灰字：分支名；detached 时短 hash。 */
function refText(worktree: GitWorktree): string {
  if (worktree.branch !== null) return worktree.branch
  return worktree.head !== null ? abbrevHash(worktree.head) : ''
}

export function GitWorktreeDropdown({
  projectPath
}: {
  projectPath: string
}): React.JSX.Element | null {
  const worktrees = useGit((s) => gitState(s, projectPath).worktrees)
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const headHash = useGit((s) => gitState(s, projectPath).headHash)
  const openDialog = useGit((s) => s.openDialog)
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const listed = listedWorktrees(worktrees)
  if (listed.length === 0) return null
  const current = listed.find((w) => w.isCurrent) ?? null
  const label = current !== null ? worktreeDisplayName(current) : '工作树'
  // 过滤只影响显示（同分支下拉）：按展示名 / 分支 / 路径任一命中；「新建」行同样参与按名过滤
  const lower = filterText.toLowerCase()
  const createVisible = filterText === '' || '新建工作树'.includes(filterText)
  const shown =
    filterText === ''
      ? listed
      : listed.filter((w) =>
          [worktreeDisplayName(w), refText(w), w.path].some((t) => t.toLowerCase().includes(lower))
        )

  const go = (worktree: GitWorktree): void => {
    if (worktree.prunable) return
    setOpen(false)
    if (worktree.isCurrent) return
    void useApp.getState().addProjectByPath(worktree.path)
  }
  const create = (): void => {
    setOpen(false)
    // 工具栏入口：起点 = 当前 HEAD（展示当前分支名，detached 时短 hash），预设新建分支
    const startLabel = currentBranch ?? (headHash !== null ? abbrevHash(headHash) : 'HEAD')
    openDialog(projectPath, {
      kind: 'worktree-add',
      start: { ref: 'HEAD', label: startLabel },
      checkout: 'new-branch',
      branch: null
    })
  }
  const remove = (e: React.MouseEvent, worktree: GitWorktree): void => {
    e.stopPropagation()
    setOpen(false)
    openDialog(projectPath, { kind: 'worktree-remove', worktree })
  }
  const prune = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setOpen(false)
    openDialog(projectPath, { kind: 'worktree-prune' })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setFilterText('') // 打开即清空过滤词（同分支下拉），输入框 autoFocus 聚焦
      }}
    >
      <PopoverTrigger
        className={ICON_BTN}
        title={current !== null ? `工作树：${label}\n${current.path}` : '工作树'}
      >
        <FolderGit2 className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="max-h-none w-72 overflow-hidden p-0">
        <div className="border-b border-[color:var(--separator)] p-1.5">
          <input
            autoFocus
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="筛选工作树…"
            className="h-7 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] px-2 text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {/* 菜单最大高度同分支下拉（≈ 297px），超出滚动 */}
        <div className="max-h-[297px] overflow-y-auto p-1.5">
          {createVisible && (
            <div className={ROW} onClick={create}>
              <Plus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                新建工作树…
              </span>
            </div>
          )}
          {shown.map((w) => {
            // 行尾钮：失效行清理登记、可删的行（非主、非本项目）删除；其余行无钮
            const action = w.prunable ? (
              <button type="button" className={ROW_BTN} title="清理失效登记…" onClick={prune}>
                <Eraser className="size-3.5" />
              </button>
            ) : !w.isMain && !w.isCurrent ? (
              <button
                type="button"
                className={ROW_BTN}
                title="删除工作树…"
                onClick={(e) => remove(e, w)}
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null
            return (
              <div
                key={w.path}
                className={cn(ROW, w.prunable && 'cursor-default opacity-50 hover:bg-transparent')}
                title={w.prunable ? `${w.path}\n目录已不存在` : w.path}
                onClick={() => go(w)}
              >
                <Check className={cn('size-3.5 shrink-0', !w.isCurrent && 'invisible')} />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {worktreeDisplayName(w)}
                </span>
                <span className={cn(REF_TEXT, action !== null && 'group-hover:opacity-0')}>
                  {refText(w)}
                </span>
                {action}
              </div>
            )
          })}
          {!createVisible && shown.length === 0 && (
            <div className="px-1.5 py-1 text-[13px] text-muted-foreground">未找到结果。</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
