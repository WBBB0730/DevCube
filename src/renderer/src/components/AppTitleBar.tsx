import { CircleDot, Settings } from 'lucide-react'
import type { AppUpdateState } from '@shared/app-update-state'
import { cn } from '@renderer/lib/utils'

type Props = {
  title: string
  update: AppUpdateState | null
  onOpenSettings: () => void
  onUpdateClick: () => void
}

/** 自定义窗口顶栏：中间标题 + 右侧更新/设置；整条可拖拽，控件 no-drag。 */
export function AppTitleBar({
  title,
  update,
  onOpenSettings,
  onUpdateClick
}: Props): React.JSX.Element {
  const isMac = window.electron.process.platform === 'darwin'
  const showUpdate = update?.showButton === true

  return (
    <div
      className="flex h-10 shrink-0 items-center border-b border-[color:var(--separator)] bg-panel"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS 红绿灯安全区 */}
      <div className={cn('shrink-0', isMac ? 'w-[78px]' : 'w-3')} />

      <div className="min-w-0 flex-1 truncate text-center text-[13px] font-bold text-[color:var(--fg-dialog-title)]">
        {title}
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          isMac ? 'pr-2' : 'pr-[calc(138px+0.5rem)]'
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showUpdate && update && (
          <button
            type="button"
            title={
              update.buttonAction === 'openRelease'
                ? `打开 GitHub Release（${update.availableVersion ?? ''}）`
                : `重启以更新到 ${update.availableVersion ?? ''}`
            }
            onClick={onUpdateClick}
            className="inline-flex size-7 items-center justify-center rounded text-[#3574F0] hover:bg-[var(--bg-button-hover)]"
          >
            <CircleDot className="size-4" />
          </button>
        )}
        <button
          type="button"
          title="设置"
          onClick={onOpenSettings}
          className="inline-flex size-7 items-center justify-center rounded text-[color:var(--fg-icon)] hover:bg-[var(--bg-button-hover)]"
        >
          <Settings className="size-4" />
        </button>
      </div>
    </div>
  )
}
