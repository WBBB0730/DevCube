// Git Tab 的根组件：每项目常驻一个（Console 里切走仅隐藏不卸载，现场保留）。
// 当前项目由 App 预加载（Tab 栏分支名）；本组件可见时若仍 idle 则补拉，已加载则重验仓库根。
// 四态渲染（非仓库 / 空仓库 / 加载中 / 出错）+ 就绪表格；
// 全局键盘只在可见时挂 capture 监听：Esc 分层关闭、Cmd/Ctrl+F 打开查找、Cmd/Ctrl+R 刷新
// （fetch + 软刷新；导航类快捷键改由主进程 before-input-event；F/R 须排除 Alt）。
import { useEffect } from 'react'
import { LoaderCircle } from 'lucide-react'
import { gitState, useGit } from '@renderer/git-store'
import { GitToolbar } from './GitToolbar'
import { GitOpStatusBar } from './GitOpStatusBar'
import { GitCommitTable } from './GitCommitTable'
import { GitFindWidget } from './GitFindWidget'
import { GitCommitDetails } from './GitCommitDetails'
import { GitDiffView } from './GitDiffView'
import { GitContextMenu } from './GitContextMenu'
import { GitDialogs } from './GitDialogs'

export function GitPane({
  projectPath,
  visible
}: {
  projectPath: string
  visible: boolean
}): React.JSX.Element {
  const status = useGit((s) => gitState(s, projectPath).status)
  const isRepo = useGit((s) => gitState(s, projectPath).isRepo)
  const isEmptyRepo = useGit((s) => gitState(s, projectPath).isEmptyRepo)
  const hasCommits = useGit((s) => gitState(s, projectPath).commits.length > 0)
  const loadError = useGit((s) => gitState(s, projectPath).loadError)
  const hasExpanded = useGit((s) => gitState(s, projectPath).expanded !== null)
  const graphLoading = useGit((s) => gitState(s, projectPath).graphLoading)
  const load = useGit((s) => s.load)

  // 可见时：仍 idle（未成过当前项目、App 预加载未赶上）则补拉；已加载则重验仓库根——
  // init / .git 删除后仓库形态变化的兜底（主通道是 watcher），变化时主进程推 git:changed。
  // 隐藏期间状态保留；.git 变动由 App 的 onGitChanged 软刷新。load 同步置 loading，
  // StrictMode 双挂载幂等；重验本身幂等，双挂载多跑一次无害。
  useEffect(() => {
    if (!visible) return
    if (gitState(useGit.getState(), projectPath).status === 'idle') {
      void load(projectPath)
    } else {
      void window.api.gitRevalidate(projectPath)
    }
  }, [visible, projectPath, load])

  // 全局键盘：capture 阶段拦截（抢在内部控件与 Electron 默认行为之前），仅可见时监听。
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      // 焦点在真输入控件（查找框、对话框表单等）时让位：Esc/Enter 由控件所属组件自理。
      const el = e.target as HTMLElement | null
      const editable =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (editable) return
      const store = useGit.getState()
      const st = gitState(store, projectPath)
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        // 分层关闭：一次 Esc 只关最上层（diff → 详情 → 菜单 → 对话框 → 查找）
        if (st.diffView) store.closeDiff(projectPath)
        else if (st.expanded) store.closeDetails(projectPath)
        else if (st.contextMenu) store.closeContextMenu(projectPath)
        else if (st.dialog) store.closeDialog(projectPath)
        else if (st.find?.open) store.setFind(projectPath, { open: false })
        else return // 无可关闭层：不吞事件
        e.preventDefault()
        e.stopPropagation()
      } else if (mod && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Cmd/Ctrl+F：打开查找（查找组件出现后自聚焦，见 G 的 GitFindWidget）
        e.preventDefault()
        e.stopPropagation()
        store.setFind(projectPath, { open: true })
      } else if (mod && !e.altKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        // Cmd/Ctrl+R：刷新 = fetch + 软刷新（顺带拦下 Electron 默认的页面重载）
        e.preventDefault()
        e.stopPropagation()
        void store.refresh(projectPath)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visible, projectPath])

  // 工具栏（分支筛选 / 视图选项 / 刷新 / 拉取 / 推送 / 创建分支 / 查找 / 设置）只在就绪且是仓库时显示（空仓库也给，刷新/设置有用）。
  const showChrome = status === 'ready' && isRepo

  return (
    <div className="flex h-full min-h-0 flex-col bg-deepest">
      {showChrome && <GitToolbar projectPath={projectPath} />}
      {/* 操作进行中状态条（变基/合并/拣选/回滚中断）：组件自判 opInProgress 为空即 null */}
      {showChrome && <GitOpStatusBar projectPath={projectPath} />}
      {status === 'idle' || status === 'loading' ? (
        <CenteredHint>
          <LoaderCircle className="size-4 animate-spin" />
          <span>加载中 …</span>
        </CenteredHint>
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
            onClick={() => void load(projectPath, { hard: true })}
            className="h-7 rounded-lg border border-[color:var(--border-input)] bg-panel px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
          >
            重试
          </button>
        </div>
      ) : !isRepo ? (
        // 非仓库兜底：初始化入口 + 手动刷新（自动跟进失灵时的兜底）；样式对齐错误态的「重试」
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
          <div className="text-sm text-muted-foreground">该项目不是 Git 仓库</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // 预填当前生效的 init.defaultBranch（未配置回落 main），拿到后再弹对话框
                void window.api.gitDefaultBranch(projectPath).then((defaultBranch) => {
                  useGit.getState().openDialog(projectPath, { kind: 'init', defaultBranch })
                })
              }}
              className="h-7 rounded-lg border border-[color:var(--border-input)] bg-panel px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
            >
              初始化 Git 仓库
            </button>
            <button
              type="button"
              onClick={() => {
                // 重验仓库根后软刷新；有变化时主进程也推 git:changed，两次 load 由代际号去重
                void window.api.gitRevalidate(projectPath).then(() => load(projectPath))
              }}
              className="h-7 rounded-lg border border-[color:var(--border-input)] bg-panel px-4 text-[13px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]"
            >
              刷新
            </button>
          </div>
        </div>
      ) : isEmptyRepo && !hasCommits ? (
        <CenteredHint>此仓库还没有任何提交</CenteredHint>
      ) : (
        // 内容区做 relative 容器：详情面板吊底（自带高度与上边框）。diff 面板 absolute
        // 只覆盖图谱表格区（挂在内层 relative 容器里），吊底的详情/文件列表仍可见。
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <GitCommitTable projectPath={projectPath} />
            <GitFindWidget projectPath={projectPath} />
            {/* diff 面板：absolute 覆盖本图谱表格区（不盖吊底详情），点文件看 diff 时文件列表仍在 */}
            <GitDiffView projectPath={projectPath} />
            {/* 切分支 / 改视图开关时只给图谱区盖半透明 loading，工具栏与详情不受影响 */}
            {graphLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 bg-deepest/70 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                <span>加载中 …</span>
              </div>
            )}
          </div>
          {hasExpanded && <GitCommitDetails projectPath={projectPath} />}
        </div>
      )}
      {/* 右键菜单与对话框自带开合判空（无内容即 null），挂在根级即可 */}
      <GitContextMenu projectPath={projectPath} />
      <GitDialogs projectPath={projectPath} />
    </div>
  )
}

/** 居中的单行状态提示（非仓库 / 空仓库 / 加载中），观感对齐 Console 的 Placeholder。 */
function CenteredHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 px-6 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
