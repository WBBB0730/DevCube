// Files 树右键菜单：文件 / 目录 / 空白区（=项目根）共用一个受控 ContextMenu + 鼠标点
// 虚拟 anchor（同 GitContextMenu 模式，非行级 Trigger）。菜单只产出操作请求，
// 实际执行与状态联动由 FilesPane 统一承接。
import { useMemo } from 'react'
import { FilePen, FilePlus, FolderOpen, FolderPen, FolderPlus, Trash2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem
} from '@renderer/components/ui/context-menu'
import type { FilesEntryDialogRequest } from './FilesEntryDialog'

export interface FilesTreeMenuTarget {
  x: number
  y: number
  /** 目标绝对逻辑路径；树空白区为项目根 */
  path: string
  isDirectory: boolean
}

export function FilesTreeMenu({
  projectRoot,
  menu,
  onClose,
  onRequest
}: {
  projectRoot: string
  menu: FilesTreeMenuTarget | null
  onClose: () => void
  onRequest: (req: FilesEntryDialogRequest) => void
}): React.JSX.Element | null {
  // 虚拟 anchor：鼠标点的 0×0 矩形，Base UI 负责翻转/贴边
  const anchor = useMemo(
    () =>
      menu === null
        ? undefined
        : { getBoundingClientRect: (): DOMRect => new DOMRect(menu.x, menu.y, 0, 0) },
    [menu]
  )
  if (menu === null || !anchor) return null

  const isRoot = menu.path === projectRoot
  const request = (req: FilesEntryDialogRequest): void => {
    onClose()
    onRequest(req)
  }

  return (
    <ContextMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ContextMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={2}
      >
        {menu.isDirectory && (
          <>
            <ContextMenuItem onClick={() => request({ kind: 'create-file', dir: menu.path })}>
              <FilePlus className="size-4" /> 新建文件
            </ContextMenuItem>
            <ContextMenuItem onClick={() => request({ kind: 'create-dir', dir: menu.path })}>
              <FolderPlus className="size-4" /> 新建文件夹
            </ContextMenuItem>
          </>
        )}
        {!isRoot && (
          <>
            {menu.isDirectory && <div className="mx-1.5 my-1 h-px bg-[var(--separator)]" />}
            <ContextMenuItem
              onClick={() =>
                request({ kind: 'rename', path: menu.path, isDirectory: menu.isDirectory })
              }
            >
              {menu.isDirectory ? <FolderPen className="size-4" /> : <FilePen className="size-4" />}{' '}
              重命名
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                request({ kind: 'trash', path: menu.path, isDirectory: menu.isDirectory })
              }
            >
              <Trash2 className="size-4" /> 删除
            </ContextMenuItem>
          </>
        )}
        <div className="mx-1.5 my-1 h-px bg-[var(--separator)]" />
        <ContextMenuItem
          onClick={() => {
            onClose()
            void window.api.revealInFolder(menu.path)
          }}
        >
          <FolderOpen className="size-4" /> 在文件夹中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
