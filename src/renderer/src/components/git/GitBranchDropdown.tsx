// 分支筛选多选下拉（toolbar-widgets §1.3 / §2）：触发行显示当前筛选，浮层含过滤输入框、
// 「全部分支」「当前分支」与分支列表。选中语义照参考实现 dropdown.ts：「全部分支」与具体项互斥、
// 全不选回落全部分支、双击「全部分支」反选全部；每次选中变化立即 setBranchFilter（store 硬刷新）。
// 「全部分支」在参考实现中 value 是空串，Runlet store 用 branchFilter=null 表达；「当前分支」用
// 哨兵 ['HEAD'] 表达（HEAD 由 git log 动态解析，checkout 后自动跟随），均仅此组件内换算。
import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

// —— 纯逻辑（选中语义 §2.5，导出供测试） ——

/** 「当前分支」的哨兵筛选：HEAD 由 git log 动态解析，checkout 后自动跟随。 */
// eslint-disable-next-line react-refresh/only-export-components -- 哨兵常量与组件同文件导出（供单测）
export const CURRENT_BRANCH_FILTER = ['HEAD']

/** filter 是否为「当前分支」模式（恰为 ['HEAD']）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function isCurrentBranchFilter(filter: string[] | null): boolean {
  return filter !== null && filter.length === 1 && filter[0] === 'HEAD'
}

/** 远程分支去掉 remotes/ 前缀（8 个字符）作为显示名；本地分支原样。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function branchDisplayName(value: string): string {
  return value.startsWith('remotes/') ? value.substring(8) : value
}

/** 单击一个具体分支后的新筛选：全部分支（null）或当前分支模式时从头选中该项；全不选回落 null。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function toggleBranch(filter: string[] | null, value: string): string[] | null {
  if (filter === null || isCurrentBranchFilter(filter)) return [value]
  const next = filter.includes(value) ? filter.filter((v) => v !== value) : [...filter, value]
  return next.length === 0 ? null : next
}

/** 双击「全部分支」的反选彩蛋：所有具体项取反（当前分支模式视同无具体选中）；反选后为空则回落 null。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function invertBranches(filter: string[] | null, branches: string[]): string[] | null {
  const cur = filter === null || isCurrentBranchFilter(filter) ? [] : filter
  const next = branches.filter((b) => !cur.includes(b))
  return next.length === 0 ? null : next
}

/** 触发行文案：「全部分支」「当前分支」或选中显示名的「A、B 和 C」串（§2.3 中文格式）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供单测）
export function branchFilterLabel(filter: string[] | null): string {
  if (filter === null) return '全部分支'
  if (isCurrentBranchFilter(filter)) return '当前分支'
  const names = filter.map(branchDisplayName)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join('、')} 和 ${names[names.length - 1]}`
}

// 触发行：观感对齐 Input（h-7 紧凑高度），宽度随内容、min 138px / max 30vw（§2.3）
const TRIGGER =
  'flex h-7 min-w-[138px] max-w-[30vw] items-center gap-1 rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] px-2 text-[13px] text-foreground outline-none transition hover:bg-[var(--bg-row-hover)] focus-visible:ring-2 focus-visible:ring-ring'
const ROW =
  'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-1.5 text-[13px] hover:bg-[var(--bg-row-hover)]'

/** 分支筛选下拉：读 store 的 branches / branchFilter，变更即触发硬刷新。 */
export function GitBranchDropdown({ projectPath }: { projectPath: string }): React.JSX.Element {
  const branches = useGit((s) => gitState(s, projectPath).branches)
  const branchFilter = useGit((s) => gitState(s, projectPath).branchFilter)
  const setBranchFilter = useGit((s) => s.setBranchFilter)
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  /** 「全部分支」双击检测（500ms 内两次单击，参考实现的计时器语义） */
  const lastShowAllClick = useRef(0)

  const label = branchFilterLabel(branchFilter)
  const lower = filterText.toLowerCase()
  // 过滤只影响显示、不影响选中态（§2.4）；「全部分支」「当前分支」行同样参与按名过滤
  const showAllVisible = filterText === '' || '全部分支'.includes(filterText)
  const currentVisible = filterText === '' || '当前分支'.includes(filterText)
  const shown =
    filterText === ''
      ? branches
      : branches.filter((b) => branchDisplayName(b).toLowerCase().includes(lower))

  const apply = (next: string[] | null): void => {
    // 与当前一致（都为全部分支、或都为当前分支模式）时不触发，避免无谓的硬刷新
    if (next === null && branchFilter === null) return
    if (isCurrentBranchFilter(next) && isCurrentBranchFilter(branchFilter)) return
    void setBranchFilter(projectPath, next)
  }

  const onShowAllClick = (): void => {
    const now = Date.now()
    if (now - lastShowAllClick.current < 500) {
      lastShowAllClick.current = 0
      apply(invertBranches(branchFilter, branches))
      return
    }
    lastShowAllClick.current = now
    apply(null)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setFilterText('') // 打开即清空过滤词（§2.2），输入框 autoFocus 聚焦
      }}
    >
      <PopoverTrigger className={TRIGGER} title={label}>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
          {label}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="max-h-none w-72 overflow-hidden p-0">
        <div className="border-b border-[color:var(--separator)] p-1.5">
          <input
            autoFocus
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="筛选分支…"
            className="h-7 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-deepest)] px-2 text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {/* 菜单最大高度 ≈ 参考的 297px（§2.3），超出滚动 */}
        <div className="max-h-[297px] overflow-y-auto p-1.5">
          {showAllVisible && (
            <div className={ROW} onClick={onShowAllClick}>
              <Check className={cn('size-3.5 shrink-0', branchFilter !== null && 'invisible')} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                全部分支
              </span>
            </div>
          )}
          {currentVisible && (
            <div className={ROW} onClick={() => apply(CURRENT_BRANCH_FILTER)}>
              <Check
                className={cn(
                  'size-3.5 shrink-0',
                  !isCurrentBranchFilter(branchFilter) && 'invisible'
                )}
              />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                当前分支
              </span>
            </div>
          )}
          {shown.map((b) => (
            <div key={b} className={ROW} onClick={() => apply(toggleBranch(branchFilter, b))}>
              <Check
                className={cn(
                  'size-3.5 shrink-0',
                  !(branchFilter?.includes(b) ?? false) && 'invisible'
                )}
              />
              <span
                className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                title={b}
              >
                {branchDisplayName(b)}
              </span>
            </div>
          ))}
          {!showAllVisible && !currentVisible && shown.length === 0 && (
            <div className="px-1.5 py-1 text-[13px] text-muted-foreground">未找到结果。</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
