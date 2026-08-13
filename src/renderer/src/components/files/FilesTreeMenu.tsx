// Files 树右键菜单：文件 / 目录 / 空白区（=项目根）共用一个受控 ContextMenu + 鼠标点
// 虚拟 anchor（同 GitContextMenu 模式，非行级 Trigger）。排布四组：新建 → 打开（在文件夹
// 中显示 / 其他应用打开 / 在终端中打开）→ 复制路径 → 重命名/删除（危险项垫底，同左树
// 「移除项目」）；文件行的新建与终端按「就近」语义作用于所在目录。弹窗类请求交
// FilesPane 统一执行，直接动作就地派发。
import { useMemo } from 'react'
import {
  Copy,
  CopySlash,
  FilePen,
  FilePlus,
  FolderOpen,
  FolderPen,
  FolderPlus,
  SquareArrowOutUpRight,
  Terminal,
  Trash2
} from 'lucide-react'
import { useApp } from '@renderer/store'
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

function MenuSeparator(): React.JSX.Element {
  return <div className="mx-1.5 my-1 h-px bg-[var(--separator)]" />
}

export function FilesTreeMenu({
  projectPath,
  projectRoot,
  menu,
  onClose,
  onRequest
}: {
  /** 项目标识（原始路径；终端会话 / Tab 归属用它） */
  projectPath: string
  /** 归一化项目根（树内逻辑路径的前缀） */
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
  /** 文件行的新建 / 终端「就近」作用于所在目录（目录与根即自身） */
  const nearestDir = menu.isDirectory ? menu.path : menu.path.slice(0, menu.path.lastIndexOf('/'))
  const request = (req: FilesEntryDialogRequest): void => {
    onClose()
    onRequest(req)
  }
  const copyText = (text: string): void => {
    onClose()
    navigator.clipboard.writeText(text).catch(() => undefined)
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
        <ContextMenuItem onClick={() => request({ kind: 'create-file', dir: nearestDir })}>
          <FilePlus className="size-4" /> 新建文件
        </ContextMenuItem>
        <ContextMenuItem onClick={() => request({ kind: 'create-dir', dir: nearestDir })}>
          <FolderPlus className="size-4" /> 新建文件夹
        </ContextMenuItem>
        <MenuSeparator />
        <ContextMenuItem
          onClick={() => {
            onClose()
            void window.api.revealInFolder(menu.path)
          }}
        >
          <FolderOpen className="size-4" /> 在文件夹中显示
        </ContextMenuItem>
        {!menu.isDirectory && (
          <ContextMenuItem
            onClick={() => {
              onClose()
              void window.api.openPath(menu.path)
            }}
          >
            <SquareArrowOutUpRight className="size-4" /> 在其他应用中打开
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => {
            onClose()
            void useApp.getState().newTerminal(projectPath, nearestDir)
          }}
        >
          <Terminal className="size-4" /> 在终端中打开
        </ContextMenuItem>
        <MenuSeparator />
        <ContextMenuItem onClick={() => copyText(menu.path)}>
          <Copy className="size-4" /> 复制路径
        </ContextMenuItem>
        {!isRoot && (
          <ContextMenuItem onClick={() => copyText(menu.path.slice(projectRoot.length + 1))}>
            <CopySlash className="size-4" /> 复制相对路径
          </ContextMenuItem>
        )}
        {!isRoot && (
          <>
            <MenuSeparator />
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
      </ContextMenuContent>
    </ContextMenu>
  )
}
