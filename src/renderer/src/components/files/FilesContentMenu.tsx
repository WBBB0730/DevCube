// 正文区右键菜单（任何已打开的条目）：复制图片（仅看图 / SVG 预览态）/ 复制文件 / 在文件夹中显示 /
// 在其他应用中打开。在鼠标点弹出（PointContextMenu），同树菜单模式。复制图片走渲染层 canvas
// 栅格化（lib/copy-image），复制文件走主进程系统剪贴板（clipboard-file）。
// 服务器上的文件没有本机专属的三项，换成「下载…」。
import { Copy, Download, Files, FolderOpen, SquareArrowOutUpRight } from 'lucide-react'
import { toSysPath } from '@renderer/lib/files-paths'
import { copyImageToClipboard } from '@renderer/lib/copy-image'
import { ContextMenuItem, PointContextMenu } from '@renderer/components/ui/context-menu'

export interface FilesContentMenuTarget {
  x: number
  y: number
  /** 当前正文文件的绝对逻辑路径 */
  path: string
  /** 取要复制的图源（位图 URL / SVG 数据 URL / 超大图的预览图 URL）；null = 不提供复制 */
  imageSrc: (() => Promise<string>) | null
}

export function FilesContentMenu({
  menu,
  onDownload,
  onClose
}: {
  menu: FilesContentMenuTarget | null
  /** 服务器上的文件：给「下载…」，不给本机专属项 */
  onDownload?: (path: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  if (menu === null) return null

  return (
    <PointContextMenu at={menu} onClose={onClose}>
      {menu.imageSrc !== null && (
        <ContextMenuItem
          onClick={() => {
            const load = menu.imageSrc!
            onClose()
            void load()
              .then(copyImageToClipboard)
              .catch((err) => console.warn('[files] 复制图片失败', err))
          }}
        >
          <Copy className="size-4" /> 复制图片
        </ContextMenuItem>
      )}
      {onDownload !== undefined ? (
        <ContextMenuItem
          onClick={() => {
            onClose()
            onDownload(menu.path)
          }}
        >
          <Download className="size-4" /> 下载…
        </ContextMenuItem>
      ) : (
        <>
          <ContextMenuItem
            onClick={() => {
              onClose()
              void window.api.filesCopyFile(toSysPath(menu.path))
            }}
          >
            <Files className="size-4" /> 复制文件
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onClose()
              void window.api.revealInFolder(toSysPath(menu.path))
            }}
          >
            <FolderOpen className="size-4" /> 在文件夹中显示
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onClose()
              void window.api.openPath(toSysPath(menu.path))
            }}
          >
            <SquareArrowOutUpRight className="size-4" /> 在其他应用中打开
          </ContextMenuItem>
        </>
      )}
    </PointContextMenu>
  )
}
