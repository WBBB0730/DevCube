// Git Tab 的根组件：每项目常驻一个（Console 里切走仅隐藏不卸载，现场保留）。先取项目的仓库清单（项目自己的仓库、
// 嵌套仓库与子模块，docs/prd/git-nested-repos.md），再显示选中的那个仓库；一个仓库都没有时是初始化页。
// 当前项目由 App 预加载（Tab 栏分支名）；到前台时自动获取（开关开着）或补拉 idle，并重新发现项目的仓库。
// 四态渲染（非仓库 / 空仓库 / 加载中 / 出错）+ 就绪表格；
// 全局键盘只在可见时挂 capture 监听：Esc 分层关闭、Cmd/Ctrl+F 打开查找、Cmd/Ctrl+R 刷新
// （fetch + 软刷新；导航类快捷键改由主进程 before-input-event；F/R 须排除 Alt）。
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { UNCOMMITTED } from '@shared/git'
import { gitState, openInitDialog, useGit } from '@renderer/git-store'
import { useApp } from '@renderer/store'
import { useRememberedPanel } from '@renderer/lib/remembered-panel'
import { isPrimaryModifierEvent } from '@renderer/lib/shortcut-label'
import { selectedTextWithin } from '@renderer/lib/find-seed'
import { isDialogOpen } from '@renderer/components/ui/dialog'
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import { GitToolbar } from './GitToolbar'
import { GitOpStatusBar } from './GitOpStatusBar'
import { GitCommitTable } from './GitCommitTable'
import { GitFindWidget } from './GitFindWidget'
import { COMMIT_PANEL_HEIGHT, GitCommitDetails } from './GitCommitDetails'
import { GitDiffView } from './GitDiffView'
import { GitContextMenu } from './GitContextMenu'
import { GitDialogs } from './GitDialogs'
import { useCommitChecks } from './use-github-checks'

function subscribeWindowFocus(onChange: () => void): () => void {
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  return () => {
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
  }
}

/** 窗口是否处于激活状态（从别的应用切回、从最小化恢复都会转为 true）。 */
function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeWindowFocus, () => document.hasFocus())
}

export function GitPane({
  projectPath,
  visible
}: {
  projectPath: string
  visible: boolean
}): React.JSX.Element {
  const repos = useGit((s) => s.projectRepos[projectPath])
  const loadRepos = useGit((s) => s.loadRepos)
  const windowFocused = useWindowFocused()
  const foreground = visible && windowFocused
  // 清单没取过：可见时取一次（当前项目已由 App 预取）。每个项目的 Git Tab 都常驻挂着，不可见的不取——
  // 没打开过的项目不完整发现（docs/prd/git-nested-repos.md「什么时候发现」）
  const listed = repos !== undefined
  useEffect(() => {
    if (visible && !listed) void loadRepos(projectPath)
  }, [visible, listed, projectPath, loadRepos])
  // 一个仓库都没有的初始化页：到前台时重查项目根（别处 init 之后跟进的兜底，主通道是 watcher）
  const noRepo = listed && repos.selected === null
  useEffect(() => {
    if (foreground && noRepo) void window.api.gitRevalidate(projectPath, 'own')
  }, [foreground, noRepo, projectPath])

  if (!listed) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-deepest">
        <LoadingHint delay={0} />
      </div>
    )
  }
  if (repos.selected === null) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-deepest">
        <GitNoRepo projectPath={projectPath} />
        <GitDialogs repoPath={projectPath} />
      </div>
    )
  }
  return (
    <GitRepoPane
      key={repos.selected}
      projectPath={projectPath}
      repoPath={repos.selected}
      hasOwnRepo={repos.list.some((r) => r.own)}
      visible={visible}
      foreground={foreground}
    />
  )
}

/** 非仓库页：在项目根初始化的入口 + 手动刷新（自动跟进失灵时的兜底）；样式对齐错误态的「重试」。 */
function GitNoRepo({ projectPath }: { projectPath: string }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
      <div className="text-sm text-muted-foreground">该项目不是 Git 仓库</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openInitDialog(projectPath)}
          className="h-7 rounded-lg border border-[color:var(--border-input)] bg-elevated px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
        >
          初始化 Git 仓库
        </button>
        <button
          type="button"
          onClick={() => {
            // 重新发现后重取清单；有变化时主进程也推 git:repos-changed，两次取清单由代际号去重
            void window.api
              .gitRevalidate(projectPath, 'all')
              .then(() => useGit.getState().loadRepos(projectPath))
          }}
          className="h-7 rounded-lg border border-[color:var(--border-input)] bg-elevated px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
        >
          刷新
        </button>
      </div>
    </div>
  )
}

/** 选中的那个仓库的 Git Tab：工具栏、图谱、详情与对话框都按 repoPath 定位状态桶。 */
function GitRepoPane({
  projectPath,
  repoPath,
  hasOwnRepo,
  visible,
  foreground
}: {
  projectPath: string
  repoPath: string
  /** 项目根是不是仓库：不是时仓库下拉里能在项目根初始化，那个对话框开在项目路径的桶上 */
  hasOwnRepo: boolean
  visible: boolean
  foreground: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const status = useGit((s) => gitState(s, repoPath).status)
  const isRepo = useGit((s) => gitState(s, repoPath).isRepo)
  const isEmptyRepo = useGit((s) => gitState(s, repoPath).isEmptyRepo)
  const hasCommits = useGit((s) => gitState(s, repoPath).commits.length > 0)
  const loadError = useGit((s) => gitState(s, repoPath).loadError)
  const hasExpanded = useGit((s) => gitState(s, repoPath).expanded !== null)
  /** 未提交普通模式 = 提交面板（ADR-0006）：没拖过详情区时，它的默认高比普通详情高一档 */
  const commitPanelOpen = useGit((s) => {
    const exp = gitState(s, repoPath).expanded
    return exp !== null && exp.hash === UNCOMMITTED && exp.compareWith === null
  })
  const details = useRememberedPanel(
    'gitDetailsHeight',
    commitPanelOpen ? COMMIT_PANEL_HEIGHT : undefined
  )
  const graphLoading = useGit((s) => gitState(s, repoPath).graphLoading)
  const load = useGit((s) => s.load)
  const gitAutoFetch = useApp((s) => s.gitAutoFetch)
  // GitHub 提交检查（登录后）：图谱每行的检查汇总按可见 / 刷新 / 前台轮询去查（docs/prd/github-checks.md）
  useCommitChecks(repoPath, visible, foreground)

  // 到前台（本 Tab 可见且窗口激活：切项目 / 切 Tab / 切仓库 / 应用切回前台）的那一刻：
  // 自动获取开着则「刷新」（先软刷新本地再 fetch；在途跳过，失败不弹框），否则仍 idle
  // （App 预加载未赶上）则补拉。同时重查项目根——项目根 init / 删 .git 后清单变化的兜底（主通道是
  // watcher；只查项目根，免得每次切回都把整个项目扫一遍），变化时主进程推 git:repos-changed。隐藏期间
  // 状态保留；.git 变动由 App 的 onGitChanged 软刷新。StrictMode 双挂载：load 同步置 loading、refresh 在途跳过、
  // 重查幂等。
  useEffect(() => {
    if (!foreground) return
    const idle = gitState(useGit.getState(), repoPath).status === 'idle'
    void window.api.gitRevalidate(projectPath, 'own')
    if (gitAutoFetch) void useGit.getState().refresh(repoPath, { suppressErrorBox: true })
    else if (idle) void load(repoPath)
  }, [foreground, projectPath, repoPath, gitAutoFetch, load])

  // 选中的仓库加载出来已不是仓库（被删了等）：重新发现，清单会换掉它（与发现时同一套判断），期间显示加载中
  const vanished = status === 'ready' && !isRepo
  useEffect(() => {
    if (vanished) void window.api.gitRevalidate(projectPath, 'all')
  }, [vanished, projectPath])

  // 全局键盘：capture 阶段拦截（抢在内部控件与 Electron 默认行为之前），仅可见时监听。
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      // 有弹窗显示着（Git 对话框、仓库设置、App 级弹窗）：键盘归弹窗，这里一概不管
      if (isDialogOpen()) return
      // 焦点在真输入控件（查找框等）时让位：Esc/Enter 由控件所属组件自理。
      const el = e.target as HTMLElement | null
      const editable =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (editable) return
      const store = useGit.getState()
      const st = gitState(store, repoPath)
      const mod = isPrimaryModifierEvent(e)
      if (e.key === 'Escape') {
        // 分层关闭：一次 Esc 只关最上层（diff → 详情 → 菜单 → 查找）
        if (st.diffView) store.closeDiff(repoPath)
        else if (st.expanded) store.closeDetails(repoPath)
        else if (st.contextMenu) store.closeContextMenu(repoPath)
        else if (st.find?.open) store.setFind(repoPath, { open: false })
        else return // 无可关闭层：不吞事件
        e.preventDefault()
        e.stopPropagation()
      } else if (mod && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Cmd/Ctrl+F：打开查找并聚焦（见 GitFindWidget），面板里选中的文字（提交详情、diff 正文）预填进查找框
        e.preventDefault()
        e.stopPropagation()
        store.openFind(repoPath, selectedTextWithin(rootRef.current))
      } else if (mod && !e.altKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        // Cmd/Ctrl+R：刷新 = fetch + 软刷新（顺带拦下 Electron 默认的页面重载）
        e.preventDefault()
        e.stopPropagation()
        void store.refresh(repoPath)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, repoPath])

  // 工具栏（分支筛选 / 视图选项 / 刷新 / 拉取 / 推送 / 创建分支 / 查找 / 设置）只在就绪且是仓库时显示（空仓库也给，刷新/设置有用）。
  const showChrome = status === 'ready' && isRepo

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-deepest">
      {showChrome && <GitToolbar projectPath={projectPath} repoPath={repoPath} />}
      {/* 操作进行中状态条（变基/合并/拣选/回滚中断）：组件自判 opInProgress 为空即 null */}
      {showChrome && <GitOpStatusBar repoPath={repoPath} />}
      {status === 'idle' || status === 'loading' || vanished ? (
        <LoadingHint delay={0} />
      ) : status === 'error' ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
          <div className="text-sm text-muted-foreground">无法加载提交</div>
          {loadError !== null && (
            <div className="max-w-[560px] select-text whitespace-pre-wrap break-all text-center font-mono text-[12px] text-muted-foreground">
              {loadError}
            </div>
          )}
          <button
            type="button"
            onClick={() => void load(repoPath, { hard: true })}
            className="h-7 rounded-lg border border-[color:var(--border-input)] bg-elevated px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
          >
            重试
          </button>
        </div>
      ) : isEmptyRepo && !hasCommits ? (
        <CenteredHint>此仓库还没有任何提交</CenteredHint>
      ) : (
        // 内容区是竖排面板组：详情面板吊底（高度可拖，分隔线即它的上边框）。diff 面板 absolute
        // 只覆盖图谱表格区（挂在表格面板里），吊底的详情/文件列表仍可见。
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="vertical" {...details.groupProps}>
            <ResizablePanel className="relative">
              <GitCommitTable repoPath={repoPath} />
              <GitFindWidget repoPath={repoPath} />
              {/* diff 面板：absolute 覆盖本图谱表格区（不盖吊底详情），点文件看 diff 时文件列表仍在 */}
              <GitDiffView repoPath={repoPath} />
              {/* 切分支 / 改视图开关时只给图谱区盖半透明 loading，工具栏与详情不受影响 */}
              {graphLoading && (
                <LoadingHint delay={0} className="absolute inset-0 z-10 bg-deepest/70" />
              )}
            </ResizablePanel>
            {hasExpanded && (
              <ResizableHandle className="bg-[var(--border-input)]" {...details.handleProps} />
            )}
            {hasExpanded && <GitCommitDetails repoPath={repoPath} panel={details.panelProps} />}
          </ResizablePanelGroup>
        </div>
      )}
      {/* 右键菜单与对话框自带开合判空（无内容即 null），挂在根级即可 */}
      <GitContextMenu repoPath={repoPath} />
      <GitDialogs repoPath={repoPath} />
      {/* 仓库下拉的「初始化 Git 仓库…」：对话框开在项目路径那个桶上 */}
      {!hasOwnRepo && <GitDialogs repoPath={projectPath} />}
    </div>
  )
}
