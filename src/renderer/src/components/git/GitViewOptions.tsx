// 工具栏「视图选项」Popover（紧挨分支筛选下拉）：五个数据可见性开关（「显示远程分支」下按远程逐个
// 勾选显示哪些，写 hideRemotes）+ 提交排序三选一。
// 原仓库设置面板「常规」区的三态 select 在此收敛为二态 checkbox：checked 按
// resolveOverride 解析（settings 未拉到前按 default 显示，快照落桶后自动纠正），
// onChange 写 enabled/disabled（updateSettings 对数据键自动硬刷新）。
// 浮层观感对齐 GitBranchDropdown（bg-elevated / p-1.5），控件用 shadcn Checkbox / RadioGroup。
import { Fragment } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  GIT_DEFAULTS,
  resolveOverride,
  type GitCommitOrdering,
  type GitRepoSettings
} from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { cn } from '@renderer/lib/utils'

const ROW =
  'flex h-7 cursor-pointer select-none items-center gap-1.5 rounded px-1.5 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]'

/** 五个二态开关行：settings 键 → 文案 / 悬停说明 / default 档的回退值。 */
const TOGGLE_ROWS: {
  key:
    | 'showRemoteBranches'
    | 'showStashes'
    | 'showTags'
    | 'includeCommitsMentionedByReflogs'
    | 'onlyFollowFirstParent'
  label: string
  title?: string
  def: boolean
}[] = [
  { key: 'showRemoteBranches', label: '显示远程分支', def: GIT_DEFAULTS.showRemoteBranches },
  { key: 'showStashes', label: '显示贮藏', def: GIT_DEFAULTS.showStashes },
  { key: 'showTags', label: '显示标签', def: GIT_DEFAULTS.showTags },
  {
    key: 'includeCommitsMentionedByReflogs',
    label: '包含仅被 reflog 提及的提交',
    title: '仅在显示所有分支时生效。',
    def: GIT_DEFAULTS.includeCommitsMentionedByReflogs
  },
  {
    key: 'onlyFollowFirstParent',
    label: '只跟随第一父提交',
    title: '发现提交时只沿第一父提交回溯，不展开其余父链。',
    def: GIT_DEFAULTS.onlyFollowFirstParent
  }
]

/** 切换某 remote 的隐藏态后的 hideRemotes 新数组（幂等：重复勾选不产生重复项）。 */
function nextHideRemotes(hideRemotes: string[], remote: string, hidden: boolean): string[] {
  const without = hideRemotes.filter((r) => r !== remote)
  return hidden ? [...without, remote] : without
}

/** 提交排序的三个 radio 选项。 */
const ORDERING_OPTIONS: { value: GitCommitOrdering; label: string }[] = [
  { value: 'date', label: '提交时间' },
  { value: 'author-date', label: '作者时间' },
  { value: 'topo', label: '拓扑顺序' }
]

/** 视图选项按钮 + Popover：数据全部读 git-store 的 settings，变更即 updateSettings。 */
export function GitViewOptions({ repoPath }: { repoPath: string }): React.JSX.Element {
  const settings = useGit((s) => gitState(s, repoPath).settings)
  const remotes = useGit((s) => gitState(s, repoPath).remotes)
  const updateSettings = useGit((s) => s.updateSettings)
  const showRemoteBranches = resolveOverride(
    settings?.showRemoteBranches ?? 'default',
    GIT_DEFAULTS.showRemoteBranches
  )
  const hideRemotes = settings?.hideRemotes ?? []

  // 'default' 档解析成生效排序值再比对 checked（与表头菜单同一套解析）
  const ordering =
    settings !== null && settings.commitOrdering !== 'default'
      ? settings.commitOrdering
      : GIT_DEFAULTS.commitOrdering

  return (
    <Popover>
      <PopoverTrigger className={TOOLBAR_BTN} title="视图选项">
        <SlidersHorizontal className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-64">
        {TOGGLE_ROWS.map((row) => (
          <Fragment key={row.key}>
            <label className={ROW} title={row.title}>
              <Checkbox
                checked={resolveOverride(settings?.[row.key] ?? 'default', row.def)}
                onCheckedChange={(checked) =>
                  // 三态写回：勾选 = enabled、取消 = disabled（updateSettings 对数据键自动硬刷新）。
                  // 计算键的对象字面量会宽化成索引签名，显式收窄回 Partial<GitRepoSettings>
                  void updateSettings(repoPath, {
                    [row.key]: checked ? 'enabled' : 'disabled'
                  } as Partial<GitRepoSettings>)
                }
              />
              {row.label}
            </label>
            {/* 显示哪些远程：缩进到上一行文字处；「显示远程分支」关时置灰（勾选状态保留） */}
            {row.key === 'showRemoteBranches' &&
              remotes.map((remote) => (
                <label
                  key={remote}
                  className={cn(ROW, 'pl-7', !showRemoteBranches && 'opacity-50')}
                >
                  <Checkbox
                    checked={!hideRemotes.includes(remote)}
                    disabled={!showRemoteBranches}
                    onCheckedChange={(checked) =>
                      void updateSettings(repoPath, {
                        hideRemotes: nextHideRemotes(hideRemotes, remote, !checked)
                      })
                    }
                  />
                  <span className="min-w-0 truncate">{remote}</span>
                </label>
              ))}
          </Fragment>
        ))}
        <div className="mx-1.5 my-1 h-px bg-[var(--border-input)]" role="separator" />
        <div className="px-1.5 py-1 text-[12px] font-medium text-muted-foreground">提交排序</div>
        <RadioGroup
          className="gap-0"
          value={ordering}
          onValueChange={(v) =>
            void updateSettings(repoPath, { commitOrdering: v as GitCommitOrdering })
          }
        >
          {ORDERING_OPTIONS.map((opt) => (
            <label key={opt.value} className={ROW}>
              <RadioGroupItem value={opt.value} />
              {opt.label}
            </label>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}
