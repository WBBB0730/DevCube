// Files Tab 工具栏：相对路径可点面包屑 + 右侧钮组（预览切换 / 最近打开 / 在文件树中显示 /
// 在文件夹中显示 / 在其他应用中打开（仅本机文件）/ 显示文件树）。视觉见 DESIGN.md「Files Tab」。
// `extra` 给特定正文（如 PDF 的页码与缩放）在钮组最左再加一组；`pathExtra` 给特定正文在面包屑之前领头加钮（如 PDF 缩略图开关）。
import { useContext } from 'react'
import {
  ChevronRight,
  Eye,
  FolderOpen,
  ListTree,
  PanelRight,
  Pencil,
  SquareArrowOutUpRight
} from 'lucide-react'
import type { GitFileStatus } from '@shared/git'
import { joinLogicalPath } from '@shared/files-path'
import { SHORTCUT } from '@shared/shortcut-label'
import { useDoubleClick } from '@renderer/lib/double-click'
import { relPathUnderRoot, toSysPath } from '@renderer/lib/files-paths'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { RecentMenu, type RecentMenuItem } from '@renderer/components/ui/recent-menu'
import { TOOLBAR_BTN, TOOLBAR_SEPARATOR } from '@renderer/components/ui/toolbar'
import { FILE_STATUS_COLOR } from '@renderer/components/git/git-details'
import { FilesLocalContext } from './files-local-context'

export type FilesToolbarProps = {
  path: string | null
  projectRoot: string
  error: string | null
  recentPaths: string[]
  /** 「最近打开文件」下拉开合（受控：⌘E / Ctrl+E 由 FilesPane 打开） */
  recentMenuOpen: boolean
  onRecentMenuOpenChange: (open: boolean) => void
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  /** 编辑 ↔ 预览切换钮：null = 不显示（非 Markdown / SVG） */
  sourcePreview?: boolean | null
  onToggleSourcePreview?: () => void
  /** 正文专属控件（如 PDF 页码与缩放），置于右侧钮组最左、以竖线隔开 */
  extra?: React.ReactNode
  /** 正文专属钮（如 PDF 缩略图开关），置于面包屑之前领头 */
  pathExtra?: React.ReactNode
  onShowTree: () => void
  onToggleTree: () => void
  onRevealInTree: (logical: string, isDirectory: boolean) => void | Promise<void>
  onOpenRecent: (logical: string) => void | Promise<void>
  /** 焦点回正文（⌘E 打开的最近文件下拉被 Esc 关掉时）；仅文本编辑器提供 */
  onFocusContent?: () => void
}

/** 「最近打开文件」下拉（见 ui/recent-menu）：每项为文件名加它在项目里的目录。 */
function RecentFilesMenu({
  path,
  projectRoot,
  recentPaths,
  open,
  onOpenChange,
  onOpenRecent,
  onFocusContent
}: {
  path: string | null
  projectRoot: string
  recentPaths: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRecent: (logical: string) => void | Promise<void>
  onFocusContent?: () => void
}): React.JSX.Element {
  const items = recentPaths.map((p): RecentMenuItem => {
    const rel = relPathUnderRoot(projectRoot, p) || p
    const slash = rel.lastIndexOf('/')
    return {
      key: p,
      name: slash >= 0 ? rel.slice(slash + 1) : rel,
      location: slash >= 0 ? rel.slice(0, slash) : '',
      title: p
    }
  })
  return (
    <RecentMenu
      title={shortcutTitle('最近打开文件', SHORTCUT.recentFiles)}
      emptyText="暂无最近打开文件"
      items={items}
      currentKey={path}
      open={open}
      onOpenChange={onOpenChange}
      onPick={(p) => void onOpenRecent(p)}
      onFocusContent={onFocusContent}
    />
  )
}

export function FilesToolbar({
  path,
  projectRoot,
  error,
  recentPaths,
  recentMenuOpen,
  onRecentMenuOpenChange,
  fileStatus,
  treeVisible,
  sourcePreview = null,
  onToggleSourcePreview,
  extra,
  pathExtra,
  onShowTree,
  onToggleTree,
  onRevealInTree,
  onOpenRecent,
  onFocusContent
}: FilesToolbarProps): React.JSX.Element {
  const local = useContext(FilesLocalContext)
  const rel = path === null ? '' : relPathUnderRoot(projectRoot, path)
  const parts = rel.split('/').filter((p) => p.length > 0)
  const fileColour = fileStatus ? FILE_STATUS_COLOR[fileStatus] : undefined
  const isDoubleClick = useDoubleClick()
  return (
    <div
      className="flex h-10 shrink-0 cursor-default items-center gap-2 border-b border-[var(--separator)] bg-panel px-2 text-[13px] select-none"
      onClick={(e) => {
        if (isDoubleClick(e)) onToggleTree()
      }}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden" title={path ?? undefined}>
        {/* 与面包屑留 8px（同工具栏各区之间的 gap-2）；面包屑截断时钮不缩；双击不触发文件树显隐（同右侧钮组） */}
        {pathExtra !== undefined && pathExtra !== null && (
          <div
            className="mr-2 flex shrink-0 items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {pathExtra}
          </div>
        )}
        {path && (
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {parts.map((part, i) => {
              const last = i === parts.length - 1
              const segmentPath = joinLogicalPath(projectRoot, parts.slice(0, i + 1).join('/'))
              return (
                <span key={`${i}:${part}`} className="flex min-w-0 items-center gap-0.5">
                  {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                  <button
                    type="button"
                    title={segmentPath}
                    className={cn(
                      'max-w-full cursor-pointer truncate transition-colors hover:text-[color:var(--fg-primary)]',
                      last ? 'text-[color:var(--files-crumb-file)]' : 'text-muted-foreground'
                    )}
                    style={
                      last
                        ? ({
                            '--files-crumb-file': fileColour ?? 'var(--fg-primary)'
                          } as React.CSSProperties)
                        : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      void onRevealInTree(segmentPath, !last)
                    }}
                  >
                    {part}
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>
      {error && <span className="shrink-0 text-xs text-[var(--status-failed)]">{error}</span>}
      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {extra !== undefined && extra !== null && (
          <>
            {extra}
            <div className={TOOLBAR_SEPARATOR} role="separator" />
          </>
        )}
        {sourcePreview !== null && (
          <>
            <button
              type="button"
              title={sourcePreview ? '编辑' : '预览'}
              className={TOOLBAR_BTN}
              onClick={onToggleSourcePreview}
            >
              {sourcePreview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
            </button>
            <div className={TOOLBAR_SEPARATOR} role="separator" />
          </>
        )}
        <RecentFilesMenu
          path={path}
          projectRoot={projectRoot}
          recentPaths={recentPaths}
          open={recentMenuOpen}
          onOpenChange={onRecentMenuOpenChange}
          onOpenRecent={onOpenRecent}
          onFocusContent={onFocusContent}
        />
        {path && (
          <>
            <button
              type="button"
              title="在文件树中显示"
              className={TOOLBAR_BTN}
              onClick={() => void onRevealInTree(path, false)}
            >
              <ListTree className="size-4" />
            </button>
            {local && (
              <>
                <button
                  type="button"
                  title="在文件夹中显示"
                  className={TOOLBAR_BTN}
                  onClick={() => void window.api.revealInFolder(toSysPath(path))}
                >
                  <FolderOpen className="size-4" />
                </button>
                <button
                  type="button"
                  title="在其他应用中打开"
                  className={TOOLBAR_BTN}
                  onClick={() => void window.api.openPath(toSysPath(path))}
                >
                  <SquareArrowOutUpRight className="size-4" />
                </button>
              </>
            )}
          </>
        )}
        {!treeVisible && (
          <>
            <div className={TOOLBAR_SEPARATOR} role="separator" />
            <button type="button" title="显示文件树" className={TOOLBAR_BTN} onClick={onShowTree}>
              <PanelRight className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
