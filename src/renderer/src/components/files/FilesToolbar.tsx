// Files Tab 工具栏：相对路径可点面包屑 + 右侧钮组（预览切换 / 最近打开 / 在文件树中显示 /
// 在文件夹中显示 / 在其他应用中打开 / 显示文件树）。视觉见 DESIGN.md「Files Tab」。
// `extra` 给特定正文（如 PDF 的页码与缩放）在钮组最左再加一组；`pathExtra` 给特定正文在面包屑之后紧跟钮（如 PDF 缩略图开关）。
import {
  ChevronRight,
  Eye,
  FileClock,
  FolderOpen,
  ListTree,
  PanelRight,
  Pencil,
  SquareArrowOutUpRight
} from 'lucide-react'
import type { GitFileStatus } from '@shared/git'
import { normalizePath } from '@shared/files-path'
import { relPathUnderRoot, toSysPath } from '@renderer/lib/files-paths'
import { cn } from '@renderer/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { FILE_STATUS_COLOR } from '@renderer/components/git/git-details'

/** 对齐 GitToolbar ICON_BTN：transition-colors + 钮组 gap-0.5 */
export const TOOLBAR_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

/** 钮组内分隔：1×12px `--border-input` 竖线 */
export const TOOLBAR_SEPARATOR = 'mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]'

export type FilesToolbarProps = {
  path: string | null
  projectRoot: string
  error: string | null
  recentPaths: string[]
  fileStatus: GitFileStatus | undefined
  treeVisible: boolean
  /** 编辑 ↔ 预览切换钮：null = 不显示（非 Markdown / SVG） */
  sourcePreview?: boolean | null
  onToggleSourcePreview?: () => void
  /** 正文专属控件（如 PDF 页码与缩放），置于右侧钮组最左、以竖线隔开 */
  extra?: React.ReactNode
  /** 正文专属钮（如 PDF 缩略图开关），紧跟在面包屑文件名之后 */
  pathExtra?: React.ReactNode
  onShowTree: () => void
  onToggleTree: () => void
  onRevealInTree: (logical: string, isDirectory: boolean) => void | Promise<void>
  onOpenRecent: (logical: string) => void | Promise<void>
}

export function FilesToolbar({
  path,
  projectRoot,
  error,
  recentPaths,
  fileStatus,
  treeVisible,
  sourcePreview = null,
  onToggleSourcePreview,
  extra,
  pathExtra,
  onShowTree,
  onToggleTree,
  onRevealInTree,
  onOpenRecent
}: FilesToolbarProps): React.JSX.Element {
  const rel =
    path && path.startsWith(projectRoot + '/') ? path.slice(projectRoot.length + 1) : (path ?? '')
  const parts = rel.split('/').filter((p) => p.length > 0)
  const fileColour = fileStatus ? FILE_STATUS_COLOR[fileStatus] : undefined
  return (
    <div
      className="flex h-10 shrink-0 cursor-default items-center gap-2 border-b border-[var(--separator)] bg-panel px-2 text-[13px] select-none"
      onDoubleClick={onToggleTree}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden" title={path ?? undefined}>
        {path && (
          <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {parts.map((part, i) => {
              const last = i === parts.length - 1
              const segmentPath = normalizePath(projectRoot + '/' + parts.slice(0, i + 1).join('/'))
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
                    onClick={() => void onRevealInTree(segmentPath, !last)}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {part}
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {/* 与文件名留 8px（同工具栏各区之间的 gap-2）；面包屑截断时钮不缩；双击不触发文件树显隐（同右侧钮组） */}
        {pathExtra !== undefined && pathExtra !== null && (
          <div
            className="ml-2 flex shrink-0 items-center gap-0.5"
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {pathExtra}
          </div>
        )}
      </div>
      {error && <span className="shrink-0 text-xs text-[var(--status-failed)]">{error}</span>}
      <div
        className="flex shrink-0 items-center gap-0.5"
        onDoubleClick={(e) => e.stopPropagation()}
      >
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
        <DropdownMenu>
          <DropdownMenuTrigger title="最近打开文件" className={TOOLBAR_BTN}>
            <FileClock className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-2xl">
            {recentPaths.length === 0 ? (
              <div className="px-2 py-1.5 text-[13px] text-muted-foreground">暂无最近打开文件</div>
            ) : (
              recentPaths.map((p) => {
                const rel = relPathUnderRoot(projectRoot, p) || p
                const slash = rel.lastIndexOf('/')
                const name = slash >= 0 ? rel.slice(slash + 1) : rel
                const dir = slash >= 0 ? rel.slice(0, slash) : ''
                return (
                  <DropdownMenuItem
                    key={p}
                    className="min-w-0 gap-1.5"
                    onClick={() => void onOpenRecent(p)}
                  >
                    <span className="shrink-0" title={p}>
                      {name}
                    </span>
                    {dir && (
                      <span className="min-w-0 truncate text-muted-foreground" title={p}>
                        {dir}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
