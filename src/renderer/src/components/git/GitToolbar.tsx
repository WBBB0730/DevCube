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
import { gitState, useGit } from '@renderer/git-store'
import { GitBranchDropdown } from './GitBranchDropdown'
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
  // 有无「未提交更改」行：提交钮仅在有改动时可用（等同于图上该行存在时才可点）
  const hasUncommitted = useGit((s) => {
    const commits = gitState(s, projectPath).commits
    return commits.length > 0 && commits[0].hash === UNCOMMITTED
  })
  const refresh = useGit((s) => s.refresh)
  const loadRepoConfig = useGit((s) => s.loadRepoConfig)
  const setFind = useGit((s) => s.setFind)
  const openDialog = useGit((s) => s.openDialog)
  const openDetails = useGit((s) => s.openDetails)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 拉取按钮的 upstream 判断依赖仓库 config（branch.<name>.remote）：就绪后按需拉一次。
  // StrictMode 双挂载幂等 —— loadRepoConfig 只是覆盖式落桶，重复调用无害。
  useEffect(() => {
    if (status === 'ready' && isRepo && config === null) void loadRepoConfig(projectPath)
  }, [status, isRepo, config, projectPath, loadRepoConfig])

  const refreshing = fetching || status === 'loading'
  // 当前分支的上游 remote（须仍在 remotes 里；config 未加载 / 无上游则 null → 拉取不可用）
  const configuredRemote =
    currentBranch !== null ? (config?.branches[currentBranch]?.remote ?? null) : null
  const upstreamRemote =
    configuredRemote !== null && remotes.includes(configuredRemote) ? configuredRemote : null

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-panel px-2">
      <span className="shrink-0 text-[13px] text-muted-foreground">分支：</span>
      <GitBranchDropdown projectPath={projectPath} />
      <div className="flex shrink-0 items-center gap-0.5">
        <GitViewOptions projectPath={projectPath} />
        <button
          type="button"
          title="查找 (⌘F)"
          className={ICON_BTN}
          onClick={() => setFind(projectPath, { open: true })}
        >
          <Search className="size-4" />
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="提交（打开未提交更改）"
          disabled={!hasUncommitted}
          className={ICON_BTN}
          // 效果等同点图上「未提交的更改」行：打开提交面板
          onClick={() => void openDetails(projectPath, UNCOMMITTED, null)}
        >
          <GitCommitHorizontal className="size-4" />
        </button>
        <button
          type="button"
          title="刷新（fetch + 重载）(⌘R)"
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
          title="拉取当前分支"
          // 已知取舍：上游分支名按同名预设（branch.<name>.merge 改名上游的少数情况
          // 由 pull-branch 对话框的 remoteRef 文案兜底，用户可取消）
          disabled={currentBranch === null || remotes.length === 0 || upstreamRemote === null}
          className={ICON_BTN}
          onClick={() =>
            currentBranch !== null &&
            upstreamRemote !== null &&
            openDialog(projectPath, {
              kind: 'pull-branch',
              remote: upstreamRemote,
              branch: currentBranch,
              remoteRef: `${upstreamRemote}/${currentBranch}`
            })
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
