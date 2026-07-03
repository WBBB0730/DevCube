// Git Tab 顶部工具栏（toolbar-widgets §1）：分支筛选下拉 + 「显示远程分支」checkbox +
// 右侧图标钮组（获取 / 刷新 / 查找 / 仓库设置）。高 40px、bg-panel，对齐 Console Tab 栏观感。
// 「显示远程分支」写 settings 三态（enabled/disabled），updateSettings 内部会触发硬刷新；
// 获取按钮仅在有远程时出现（§1.5），点击 = fetch --all（prune 暂固定 false，仓库级默认后续接入）。
import { useState } from 'react'
import { CloudDownload, LoaderCircle, RotateCw, Search, Settings } from 'lucide-react'
import { GIT_DEFAULTS, resolveOverride } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { GitBranchDropdown } from './GitBranchDropdown'
import { GitRepoSettings } from './GitRepoSettings'

// 图标钮：观感对齐 Console Tab 栏的「新建终端」按钮（size-7 圆角 hover 加亮）
const ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

/** 工具栏：数据全部读 git-store，仓库设置面板的开合是本组件的局部状态。 */
export function GitToolbar({ projectPath }: { projectPath: string }): React.JSX.Element {
  const status = useGit((s) => gitState(s, projectPath).status)
  const remotes = useGit((s) => gitState(s, projectPath).remotes)
  const settings = useGit((s) => gitState(s, projectPath).settings)
  const load = useGit((s) => s.load)
  const updateSettings = useGit((s) => s.updateSettings)
  const setFind = useGit((s) => s.setFind)
  const runAction = useGit((s) => s.runAction)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // settings 未拉到前按 default 解析显示（拉到后权威快照落桶自动纠正）
  const showRemoteBranches = resolveOverride(
    settings?.showRemoteBranches ?? 'default',
    GIT_DEFAULTS.showRemoteBranches
  )
  const refreshing = status === 'loading'

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-panel px-2">
      <span className="shrink-0 text-[13px] text-muted-foreground">分支：</span>
      <GitBranchDropdown projectPath={projectPath} />
      <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[13px] text-foreground">
        <input
          type="checkbox"
          checked={showRemoteBranches}
          onChange={(e) =>
            // 三态写回：勾选 = enabled、取消 = disabled（updateSettings 对数据键自动硬刷新）
            void updateSettings(projectPath, {
              showRemoteBranches: e.target.checked ? 'enabled' : 'disabled'
            })
          }
          className="accent-[var(--primary)]"
        />
        显示远程分支
      </label>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {remotes.length > 0 && (
          <button
            type="button"
            title="从远程获取"
            className={ICON_BTN}
            onClick={() =>
              void runAction(
                projectPath,
                { kind: 'fetch', remote: null, prune: false, pruneTags: false },
                '正在从远程获取…'
              )
            }
          >
            <CloudDownload className="size-4" />
          </button>
        )}
        <button
          type="button"
          title={refreshing ? '正在刷新' : '刷新 (⌘R)'}
          disabled={refreshing}
          className={ICON_BTN}
          onClick={() => void load(projectPath)}
        >
          {refreshing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
        </button>
        <button
          type="button"
          title="查找 (⌘F)"
          className={ICON_BTN}
          onClick={() => setFind(projectPath, { open: true })}
        >
          <Search className="size-4" />
        </button>
        <button
          type="button"
          title="仓库设置"
          className={ICON_BTN}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <Settings className="size-4" />
        </button>
      </div>
      <GitRepoSettings
        projectPath={projectPath}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
