import { useState } from 'react'
import { CircleArrowUp, Settings } from 'lucide-react'
import { GITHUB_REPO_URL } from '@shared/app-update'
import type { AppUpdateState, DevUpdatePreview } from '@shared/app-update-state'
import { UpdateDialog } from '@renderer/components/UpdateDialog'
import { cn } from '@renderer/lib/utils'

/** 顶栏右侧的宿主动作钮（如 Preview Window 的「添加为项目 / 转到项目」），排在更新 / 设置之前 */
export type TitleBarAction = {
  key: string
  title: string
  icon: React.ReactNode
  onClick: () => void
}

type Props = {
  title: string
  /** 右侧更新 / 设置钮；不传即只有标题 */
  update?: AppUpdateState | null
  onOpenSettings?: () => void
  /** 更新弹窗里确认后执行（安装或打开 Release）；点更新钮本身只开弹窗 */
  onPerformUpdate?: () => void
  actions?: TitleBarAction[]
}

/** 与 `size-7` / `gap-0.5` 对齐；标题两侧在控件占用之外再留的空隙。 */
const BTN = 28
const BTN_GAP = 2
const TITLE_GAP = 8

/**
 * 自定义窗口顶栏：中间标题 + 右侧更新/设置；整条可拖拽，控件 no-drag。
 * 更新钮先开更新弹窗（列出更新日志），确认后才执行；未包装开发另常驻一颗绿色钮，
 * 读工作区 CHANGELOG.md 预览同一个弹窗（不联网，见 docs/prd/changelog.md）。
 */
export function AppTitleBar({
  title,
  update = null,
  onOpenSettings,
  onPerformUpdate,
  actions = []
}: Props): React.JSX.Element {
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [devPreview, setDevPreview] = useState<DevUpdatePreview | null>(null)
  const isMac = window.electron.process.platform === 'darwin'
  const showUpdate = update?.showButton === true && onPerformUpdate !== undefined
  const showDevPreview = import.meta.env.DEV && onPerformUpdate !== undefined
  const showSettings = onOpenSettings !== undefined

  const leftReserve = isMac ? 78 : 12
  const rightPad = isMac ? 8 : 138 + 8
  const rightCount =
    actions.length + (showDevPreview ? 1 : 0) + (showUpdate ? 1 : 0) + (showSettings ? 1 : 0)
  const rightButtons = rightCount * BTN + Math.max(rightCount - 1, 0) * BTN_GAP
  const rightReserve = rightButtons + rightPad
  const titleMaxWidth = `calc(100% - ${2 * (Math.max(leftReserve, rightReserve) + TITLE_GAP)}px)`

  return (
    <>
      <div
        className="relative flex h-10 shrink-0 items-center border-b border-[color:var(--separator)] bg-panel"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="truncate text-center text-[13px] font-bold text-[color:var(--fg-dialog-title)]"
            style={{ maxWidth: titleMaxWidth }}
          >
            {title}
          </div>
        </div>

        {/* macOS 红绿灯安全区 */}
        <div className={cn('shrink-0', isMac ? 'w-[78px]' : 'w-3')} />

        <div className="min-w-0 flex-1" />

        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            isMac ? 'pr-2' : 'pr-[calc(138px+0.5rem)]'
          )}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              title={a.title}
              onClick={a.onClick}
              className="inline-flex size-7 items-center justify-center rounded text-[color:var(--fg-icon)] hover:bg-[var(--bg-button-hover)]"
            >
              {a.icon}
            </button>
          ))}
          {showDevPreview && (
            <button
              type="button"
              title="预览更新日志（本地）"
              onClick={() => void window.api.getDevChangelogPreview().then(setDevPreview)}
              className="inline-flex size-7 items-center justify-center rounded text-[color:var(--run-glyph)] hover:bg-[var(--bg-button-hover)]"
            >
              <CircleArrowUp className="size-4" />
            </button>
          )}
          {showUpdate && update && (
            <button
              type="button"
              title={
                update.buttonAction === 'openRelease'
                  ? `立即更新到 ${update.availableVersion ?? ''}`
                  : `重启以更新到 ${update.availableVersion ?? ''}`
              }
              onClick={() => setUpdateDialogOpen(true)}
              className="inline-flex size-7 items-center justify-center rounded text-primary hover:bg-[var(--bg-button-hover)]"
            >
              <CircleArrowUp className="size-4" />
            </button>
          )}
          {showSettings && (
            <button
              type="button"
              title="设置"
              onClick={onOpenSettings}
              className="inline-flex size-7 items-center justify-center rounded text-[color:var(--fg-icon)] hover:bg-[var(--bg-button-hover)]"
            >
              <Settings className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* 弹窗放在拖拽区之外：否则顶栏那一条仍按窗口拖拽处理，遮罩点不到 */}
      {updateDialogOpen && update && onPerformUpdate && (
        <UpdateDialog
          productName={update.productName}
          currentVersion={update.currentVersion}
          targetVersion={update.availableVersion ?? ''}
          changelog={update.changelog}
          action={update.buttonAction}
          onConfirm={() => {
            setUpdateDialogOpen(false)
            onPerformUpdate()
          }}
          onCancel={() => setUpdateDialogOpen(false)}
        />
      )}
      {devPreview && (
        <UpdateDialog
          {...devPreview}
          action="openRelease"
          onConfirm={() => {
            setDevPreview(null)
            // 预览的版本尚未发布，没有自己的 Release 页，去列表页
            void window.api.openExternal(`${GITHUB_REPO_URL}/releases`)
          }}
          onCancel={() => setDevPreview(null)}
        />
      )}
    </>
  )
}
