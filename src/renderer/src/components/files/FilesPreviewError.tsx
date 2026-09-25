// Files Tab 正文预览打不开时的占位（PDF / PPT / 表格 / 图片共用）。
import { toSysPath } from '@renderer/lib/files-paths'

const ACTION_BTN =
  'rounded-lg px-3 py-1.5 text-[color:var(--fg-primary)] transition-colors hover:bg-[var(--bg-button-hover)]'

/** 打不开（加密、损坏、超出限额、解码失败）：盖满正文区的占位 +（可重试时）「重试」+「在其他应用中打开」 */
export function FilesPreviewError({
  title,
  message,
  path,
  onRetry
}: {
  title: string
  message: string
  path: string
  onRetry?: () => void
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-deepest px-6 text-sm text-muted-foreground">
      <p>{title}</p>
      <p className="text-xs">{message}</p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <button type="button" className={ACTION_BTN} onClick={onRetry}>
            重试
          </button>
        )}
        <button
          type="button"
          className={ACTION_BTN}
          onClick={() => void window.api.openPath(toSysPath(path))}
        >
          在其他应用中打开
        </button>
      </div>
    </div>
  )
}
