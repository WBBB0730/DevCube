// Git Tab 顶部工具栏：左侧「分支：」标签 + 分支筛选下拉 + 视图选项 Popover + 查找；
// 右侧图标钮组（提交 / 刷新 / 拉取 / 推送 / 创建分支 / 仓库设置）。高 40px、bg-panel，
// 对齐 Console Tab 栏观感。刷新 = fetch + 静默软重载（store.refresh，fetch 期间小圈转动、
// 不弹进行中遮罩）；拉取 / 推送 / 创建分支预设目标后打开既有对话框（GitDialogs）。
import { useEffect, useState } from 'react'
import {
  CircleArrowDown,
  CircleArrowUp,
  GitBranchPlus,
  GitCommitHorizontal,
  LoaderCircle,
  RotateCw,
  Search,
  Settings
} from 'lucide-react'
import { UNCOMMITTED } from '@shared/git'
import { SHORTCUT } from '@shared/shortcut-label'
import { gitState, useGit } from '@renderer/git-store'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { GitBranchDropdown } from './GitBranchDropdown'
import { opBlockReason } from './GitOpStatusBar'
import { GitViewOptions } from './GitViewOptions'
import { GitRepoSettings } from './GitRepoSettings'

// 图标钮：观感对齐 Console Tab 栏的「新建终端」按钮（size-7 圆角 hover 加亮）
const ICON_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

/** 工具栏：数据全部读 git-store，仓库设置面板的开合是本组件的局部状态。 */
export function GitToolbar({ projectPath }: { projectPath: string }): React.JSX.Element {
  const status = useGit((s) => gitState(s, projectPath).status)
  const isRepo = useGit((s) => gitState(s, projectPath).isRepo)
  const remotes = useGit((s) => gitState(s, projectPath).remotes)
  const currentBranch = useGit((s) => gitState(s, projectPath).currentBranch)
  const headHash = useGit((s) => gitState(s, projectPath).headHash)
  const config = useGit((s) => gitState(s, projectPath).config)
  const fetching = useGit((s) => gitState(s, projectPath).fetching)
  const opInProgress = useGit((s) => gitState(s, projectPath).opInProgress)
  // 提交钮可用性：图上有任意行即可打开提交面板（无改动也能开，如只勾「修正」改信息）；
  // 空图（空仓库且无改动）禁用——GitPane 此时只渲染占位提示，详情面板无处停靠
  const hasCommits = useGit((s) => gitState(s, projectPath).commits.length > 0)
  const refresh = useGit((s) => s.refresh)
  const loadRepoConfig = useGit((s) => s.loadRepoConfig)
  const setFind = useGit((s) => s.setFind)
  const openDialog = useGit((s) => s.openDialog)
  const openDetails = useGit((s) => s.openDetails)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // pull/push 对话框的默认值依赖仓库 config（branch.<name>.remote/merge/rebase）：就绪后
  // 按需预拉一次。StrictMode 双挂载幂等 —— loadRepoConfig 只是覆盖式落桶，重复调用无害。
  useEffect(() => {
    if (status === 'ready' && isRepo && config === null) void loadRepoConfig(projectPath)
  }, [status, isRepo, config, projectPath, loadRepoConfig])

  const refreshing = fetching || status === 'loading'

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-panel px-2">
      <span className="shrink-0 text-[13px] text-muted-foreground">分支：</span>
      <GitBranchDropdown projectPath={projectPath} />
      <div className="flex shrink-0 items-center gap-0.5">
        <GitViewOptions projectPath={projectPath} />
        <button
          type="button"
          title={shortcutTitle('查找', SHORTCUT.find)}
          className={ICON_BTN}
          onClick={() => setFind(projectPath, { open: true })}
        >
          <Search className="size-4" />
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="提交（打开提交面板）"
          disabled={!hasCommits}
          className={ICON_BTN}
          // 效果等同点图上「未提交的更改」行：打开提交面板（无该行时也可开，收敛豁免见 store）
          onClick={() => void openDetails(projectPath, UNCOMMITTED, null)}
        >
          <GitCommitHorizontal className="size-4" />
        </button>
        <button
          type="button"
          title={shortcutTitle('刷新（fetch + 重载）', SHORTCUT.refresh)}
          disabled={refreshing}
          className={ICON_BTN}
          onClick={() => void refresh(projectPath)}
        >
          {refreshing ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RotateCw className="size-4" />
          )}
        </button>
        <button
          type="button"
          // 操作进行中（变基/合并等冲突中途）时禁用并以 title 注明原因：pull 会动工作区必撞车
          title={opInProgress !== null ? opBlockReason(opInProgress) : '拉取当前分支'}
          // 无上游也可打开：remote / 远程分支 / 整合方式都在表单里选（默认值按上游配置求值）
          disabled={currentBranch === null || remotes.length === 0 || opInProgress !== null}
          className={ICON_BTN}
          onClick={() =>
            currentBranch !== null && openDialog(projectPath, { kind: 'pull-branch', preset: null })
          }
        >
          <CircleArrowDown className="size-4" />
        </button>
        <button
          type="button"
          title="推送当前分支"
          disabled={currentBranch === null || remotes.length === 0}
          className={ICON_BTN}
          onClick={() =>
            currentBranch !== null &&
            openDialog(projectPath, { kind: 'push-branch', branch: currentBranch })
          }
        >
          <CircleArrowUp className="size-4" />
        </button>
        <button
          type="button"
          title="在 HEAD 创建分支"
          disabled={headHash === null}
          className={ICON_BTN}
          onClick={() =>
            headHash !== null && openDialog(projectPath, { kind: 'create-branch', hash: headHash })
          }
        >
          <GitBranchPlus className="size-4" />
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
