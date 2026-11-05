// Git Tab 顶部工具栏：左侧「分支：」标签 + 分支筛选下拉 + 工作树图标钮 + 视图选项 Popover + 查找；项目里不止一个
// 仓库时最左边先是「仓库：」标签 + 仓库下拉（GitRepoDropdown）。右侧图标钮组（提交 / 刷新 / 拉取 / 推送 / 创建分支 /
// 仓库设置），仓库在 GitHub 上而未登录时最前面多一个 GitHub 标志的「登录 GitHub」钮（docs/prd/github-checks.md；登录后即消失）。高 40px、bg-panel，
// 对齐 Console Tab 栏观感。刷新 = fetch + 静默软重载（store.refresh，fetch 期间换成转圈图标、
// 结束后转回原位才换回刷新图标，不弹进行中遮罩）；创建分支预设目标后打开既有对话框（GitDialogs）。
// 拉取 / 推送：单击按本仓库的「拉取 / 推送时不显示窗口」开关直接执行（= 对话框默认值原样提交）或打开对话框，
// 按住 ⌘/Ctrl 单击反过来；默认值拿不准（无上游等）时两种点法都打开对话框。
import { useEffect, useState } from 'react'
import {
  CircleArrowDown,
  CircleArrowUp,
  GitBranchPlus,
  GitCommitHorizontal,
  Search,
  Settings
} from 'lucide-react'
import { GIT_PULL_MODE_LABEL, UNCOMMITTED, showsRepoPicker } from '@shared/git'
import { SHORTCUT } from '@shared/shortcut-label'
import { gitState, useGit } from '@renderer/git-store'
import { useGitHub } from '@renderer/github-store'
import { isPrimaryModifierEvent, shortcutLabel, shortcutTitle } from '@renderer/lib/shortcut-label'
import { RefreshButton, TOOLBAR_BTN, TOOLBAR_SEPARATOR } from '@renderer/components/ui/toolbar'
import { GitHubLoginDialog } from '@renderer/components/GitHubLoginDialog'
import { GitHubMark } from '@renderer/components/ui/github-mark'
import { GitBranchDropdown } from './GitBranchDropdown'
import { GitRepoDropdown } from './GitRepoDropdown'
import { opBlockReason } from './GitOpStatusBar'
import { GitViewOptions } from './GitViewOptions'
import { GitWorktreeDropdown } from './GitWorktreeDropdown'
import { GitRepoSettings } from './GitRepoSettings'
import { directPullAction, directPushAction } from './git-pull-push'

/**
 * 拉取 / 推送钮的 title：首行 = 单击做什么，次行 = 按住主修饰键单击做什么。what = 直接执行时
 * 做什么；null = 拿不准（两种点法都打开对话框），只留首行。
 */
function pullPushTitle(verb: '拉取' | '推送', what: string | null, skipDialog: boolean): string {
  const base = `${verb}当前分支`
  if (what === null) return base
  const mod = shortcutLabel({ mod: true, key: '' })
  return skipDialog
    ? `${what}\n按住 ${mod} 点击打开${verb}选项`
    : `${base}\n按住 ${mod} 点击直接${what}`
}

/** 工具栏：数据全部读 git-store，仓库设置面板的开合是本组件的局部状态。 */
export function GitToolbar({
  projectPath,
  repoPath
}: {
  projectPath: string
  repoPath: string
}): React.JSX.Element {
  const repoPickerShown = useGit((s) => showsRepoPicker(s.projectRepos[projectPath]?.list ?? []))
  const status = useGit((s) => gitState(s, repoPath).status)
  const isRepo = useGit((s) => gitState(s, repoPath).isRepo)
  const remotes = useGit((s) => gitState(s, repoPath).remotes)
  const remoteBranches = useGit((s) => gitState(s, repoPath).remoteBranches)
  const currentBranch = useGit((s) => gitState(s, repoPath).currentBranch)
  const headHash = useGit((s) => gitState(s, repoPath).headHash)
  const config = useGit((s) => gitState(s, repoPath).config)
  const settings = useGit((s) => gitState(s, repoPath).settings)
  const fetching = useGit((s) => gitState(s, repoPath).fetching)
  const opInProgress = useGit((s) => gitState(s, repoPath).opInProgress)
  // 提交钮可用性：图上有任意行即可打开提交面板（无改动也能开，如只勾「修正」改信息）；
  // 空图（空仓库且无改动）禁用——GitPane 此时只渲染占位提示，详情面板无处停靠
  const hasCommits = useGit((s) => gitState(s, repoPath).commits.length > 0)
  const refresh = useGit((s) => s.refresh)
  const loadRepoConfig = useGit((s) => s.loadRepoConfig)
  const openFind = useGit((s) => s.openFind)
  const openDialog = useGit((s) => s.openDialog)
  const pullCurrentBranch = useGit((s) => s.pullCurrentBranch)
  const pushCurrentBranch = useGit((s) => s.pushCurrentBranch)
  const openDetails = useGit((s) => s.openDetails)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const signedIn = useGitHub((s) => s.account !== null)
  const [onGitHub, setOnGitHub] = useState(false)
  const [githubLoginOpen, setGitHubLoginOpen] = useState(false)
  // title 里写出直接执行时做什么（对话框默认值原样提交）；null = 拿不准，点了照样打开对话框
  const directState = { currentBranch, remotes, remoteBranches, config, settings }
  const directPull = directPullAction(directState)
  const directPush = directPushAction(directState)
  const pullTitle = pullPushTitle(
    '拉取',
    directPull !== null
      ? `从 ${directPull.remote}/${directPull.branch} 拉取（${GIT_PULL_MODE_LABEL[directPull.mode]}）`
      : null,
    settings?.pullSkipDialog ?? false
  )
  const pushTitle = pullPushTitle(
    '推送',
    directPush !== null ? `推送到 ${directPush.remote}/${directPush.targetBranch}` : null,
    settings?.pushSkipDialog ?? false
  )
  // 远程地址的签名：config 每次软刷新都换引用，只在地址真变了（增删改远程）时才重新判断
  const remoteUrls = config?.remotes.map((r) => `${r.name} ${r.url ?? ''}`).join('\n') ?? ''

  // pull/push 对话框的默认值依赖仓库 config（branch.<name>.remote/merge/rebase）：就绪后
  // 按需预拉一次。StrictMode 双挂载幂等 —— loadRepoConfig 只是覆盖式落桶，重复调用无害。
  useEffect(() => {
    if (status === 'ready' && isRepo && config === null) void loadRepoConfig(repoPath)
  }, [status, isRepo, config, repoPath, loadRepoConfig])

  // 登录入口：未登录时问主进程仓库在不在 GitHub 上（与查检查结果同一套认法）
  useEffect(() => {
    if (signedIn || !isRepo) return
    let alive = true
    void window.api.githubHasRepo(repoPath).then((yes) => {
      if (alive) setOnGitHub(yes)
    })
    return () => {
      alive = false
    }
  }, [repoPath, signedIn, isRepo, remoteUrls])

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 bg-panel px-2">
      {repoPickerShown && (
        <>
          <span className="shrink-0 text-[13px] text-muted-foreground">仓库：</span>
          <GitRepoDropdown projectPath={projectPath} />
        </>
      )}
      <span className="shrink-0 text-[13px] text-muted-foreground">分支：</span>
      <GitBranchDropdown repoPath={repoPath} />
      <div className="flex shrink-0 items-center gap-0.5">
        <GitWorktreeDropdown repoPath={repoPath} />
        <GitViewOptions repoPath={repoPath} />
        <button
          type="button"
          title={shortcutTitle('查找', SHORTCUT.find)}
          className={TOOLBAR_BTN}
          onClick={() => openFind(repoPath)}
        >
          <Search className="size-4" />
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {!signedIn && onGitHub && (
          <>
            <button
              type="button"
              title="登录 GitHub，查看提交的检查结果"
              className={TOOLBAR_BTN}
              onClick={() => setGitHubLoginOpen(true)}
            >
              <GitHubMark className="size-4" />
            </button>
            <span role="separator" className={TOOLBAR_SEPARATOR} />
          </>
        )}
        <button
          type="button"
          title="提交（打开提交面板）"
          disabled={!hasCommits}
          className={TOOLBAR_BTN}
          // 效果等同点图上「未提交的更改」行：打开提交面板（无该行时也可开，收敛豁免见 store）
          onClick={() => void openDetails(repoPath, UNCOMMITTED, null)}
        >
          <GitCommitHorizontal className="size-4" />
        </button>
        <RefreshButton
          refreshing={fetching || status === 'loading'}
          title={shortcutTitle('刷新（fetch + 重载）', SHORTCUT.refresh)}
          onClick={() => void refresh(repoPath)}
        />
        <button
          type="button"
          // 操作进行中（变基/合并等冲突中途）时禁用并以 title 注明原因：pull 会动工作区必撞车
          title={opInProgress !== null ? opBlockReason(opInProgress) : pullTitle}
          // 无上游也可打开：remote / 远程分支 / 整合方式都在表单里选（默认值按上游配置求值）
          disabled={currentBranch === null || remotes.length === 0 || opInProgress !== null}
          className={TOOLBAR_BTN}
          onClick={(e) =>
            pullCurrentBranch(repoPath, isPrimaryModifierEvent(e) ? 'invert' : 'follow')
          }
        >
          <CircleArrowDown className="size-4" />
        </button>
        <button
          type="button"
          title={pushTitle}
          disabled={currentBranch === null || remotes.length === 0}
          className={TOOLBAR_BTN}
          onClick={(e) =>
            pushCurrentBranch(repoPath, isPrimaryModifierEvent(e) ? 'invert' : 'follow')
          }
        >
          <CircleArrowUp className="size-4" />
        </button>
        <button
          type="button"
          title="在 HEAD 创建分支"
          disabled={headHash === null}
          className={TOOLBAR_BTN}
          onClick={() =>
            headHash !== null && openDialog(repoPath, { kind: 'create-branch', hash: headHash })
          }
        >
          <GitBranchPlus className="size-4" />
        </button>
        <button
          type="button"
          title="仓库设置"
          className={TOOLBAR_BTN}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <Settings className="size-4" />
        </button>
      </div>
      <GitRepoSettings
        repoPath={repoPath}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {githubLoginOpen && <GitHubLoginDialog onClose={() => setGitHubLoginOpen(false)} />}
    </div>
  )
}
