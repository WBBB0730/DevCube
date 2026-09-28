// Files Tab 正文预览打不开时的占位（PDF / PPT / 表格 / 图片共用）。
import { useContext } from 'react'
import { Button } from '@renderer/components/ui/button'
import { toSysPath } from '@renderer/lib/files-paths'
import { FilesDownloadContext, FilesLocalContext } from './files-local-context'

/**
 * 打不开（加密、损坏、超出限额、解码失败）：盖满正文区的占位 +（可重试时）「重试」+ 本机文件「在其他应用中打开」、
 * 服务器上的文件「下载」
 */
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
  const local = useContext(FilesLocalContext)
  const download = useContext(FilesDownloadContext)
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-deepest px-6 text-sm text-muted-foreground">
      <p>{title}</p>
      <p className="text-xs">{message}</p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        )}
        {local && (
          <Button variant="secondary" onClick={() => void window.api.openPath(toSysPath(path))}>
            在其他应用中打开
          </Button>
        )}
        {download && (
          <Button variant="secondary" onClick={download}>
            下载
          </Button>
        )}
      </div>
    </div>
  )
}
