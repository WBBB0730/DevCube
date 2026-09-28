// Files 树右键菜单：文件 / 目录 / 空白区（=项目根）共用一个受控 ContextMenu + 鼠标点
// 虚拟 anchor（同 GitContextMenu 模式，非行级 Trigger）。排布四组：新建 → 打开（在文件夹
// 中显示 / 其他应用打开 / 在终端中打开）→ 复制文件 / 复制路径 → 重命名/删除（危险项垫底，同左树
// 「移除项目」）；文件行的新建与终端按「就近」语义作用于所在目录。弹窗类请求交
// FilesPane 统一执行，直接动作就地派发。Preview Window 宿主另在「打开」组后加一组根导航：
// 「上一级文件夹」「添加为项目 / 转到项目」（仅空白区 / 根；到文件系统根置灰）与「进入此文件夹」（目录，根自身没有），
// 见 docs/prd/file-preview-window.md。服务器宿主换成服务器上的那一组（docs/prd/server-files.md）：
// 新建 → 上传 / 下载 → 在 SSH 终端中打开 → 复制路径 → 重命名/删除（删除不可恢复），没有本机专属项。
import { useMemo, useRef } from 'react'
import {
  Copy,
  CornerLeftUp,
  CornerRightDown,
  Download,
  FilePen,
  FilePlus,
  FileUp,
  Files,
  FolderOpen,
  FolderPen,
  FolderPlus,
  FolderSymlink,
  FolderUp,
  SquareArrowOutUpRight,
  Terminal,
  Trash2
} from 'lucide-react'
import { useApp } from '@renderer/store'
import { relPathUnderRoot, toSysPath } from '@renderer/lib/files-paths'
import { logicalParentPath } from '@shared/files-path'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@renderer/components/ui/context-menu'
import type { FilesEntryDialogRequest } from './FilesEntryDialog'

export interface FilesTreeMenuTarget {
  x: number
  y: number
  /** 目标绝对逻辑路径；树空白区为项目根 */
  path: string
  isDirectory: boolean
}

/** 服务器宿主的菜单动作（有它即换成服务器上的那一组菜单）。 */
export interface FilesTreeServerActions {
  onUpload: (dir: string, kind: 'file' | 'directory') => void
  onDownload: (path: string, isDirectory: boolean) => void
  onOpenInSshTerminal: (dir: string) => void
}

export function FilesTreeMenu({
  projectPath,
  projectRoot,
  menu,
  terminal = true,
  onSetRoot,
  onAscend,
  onAddProject,
  projectRegistered = false,
  server,
  onClose,
  onRequest
}: {
  /** 项目标识（原始路径；终端会话 / Tab 归属用它） */
  projectPath: string
  /** 是否提供「在终端中打开」（Preview Window 无 Terminal，传 false） */
  terminal?: boolean
  /** Preview Window：把该目录设为树的根（上翻后可再收回到子目录）；不传则无此项 */
  onSetRoot?: (dir: string) => void
  /** Preview Window：空白区 / 根的「上一级」；undefined = 宿主不支持，null = 已到文件系统根（置灰） */
  onAscend?: (() => void) | null
  /** Preview Window：空白区 / 根的「添加为项目 / 转到项目」（作用于当前根）；不传则无此项 */
  onAddProject?: () => void
  projectRegistered?: boolean
  /** 服务器宿主：换成服务器上的那一组菜单 */
  server?: FilesTreeServerActions
  /** 归一化项目根（树内逻辑路径的前缀） */
  projectRoot: string
  menu: FilesTreeMenuTarget | null
  onClose: () => void
  onRequest: (req: FilesEntryDialogRequest) => void
}): React.JSX.Element | null {
  /**
   * 关菜单的原因：选了菜单项就不把焦点还给文件树，交给动作自己（新建 / 重命名弹窗要聚焦输入框，
   * 还焦点在微任务里，会把它抢走）；Esc、点外面关掉才还，树上打字照常转进树顶输入。
   */
  const closeReason = useRef<string | null>(null)
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
  /** 文件行的新建 / 终端 / 上传「就近」作用于所在目录（目录与根即自身） */
  const nearestDir = menu.isDirectory ? menu.path : logicalParentPath(menu.path)
  const request = (req: FilesEntryDialogRequest): void => {
    onClose()
    onRequest(req)
  }
  const copyText = (text: string): void => {
    onClose()
    navigator.clipboard.writeText(text).catch(() => undefined)
  }
  const act = (fn: () => void) => (): void => {
    onClose()
    fn()
  }

  // 服务器：上传 / 下载 → 在 SSH 终端中打开 → 复制路径
  const serverItems = server !== undefined && (
    <>
      <ContextMenuItem onClick={act(() => server.onUpload(nearestDir, 'file'))}>
        <FileUp className="size-4" /> 上传文件…
      </ContextMenuItem>
      <ContextMenuItem onClick={act(() => server.onUpload(nearestDir, 'directory'))}>
        <FolderUp className="size-4" /> 上传文件夹…
      </ContextMenuItem>
      {!isRoot && (
        <ContextMenuItem onClick={act(() => server.onDownload(menu.path, menu.isDirectory))}>
          <Download className="size-4" /> 下载…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={act(() => server.onOpenInSshTerminal(nearestDir))}>
        <Terminal className="size-4" /> 在 SSH 终端中打开
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => copyText(menu.path)}>
        <Copy className="size-4" /> 复制路径
      </ContextMenuItem>
    </>
  )

  // 本机：打开（在文件夹中显示 / 其他应用 / 终端）→ 预览窗口的根导航 → 复制文件 / 路径
  const localItems = server === undefined && (
    <>
      <ContextMenuItem onClick={act(() => void window.api.revealInFolder(menu.path))}>
        <FolderOpen className="size-4" /> 在文件夹中显示
      </ContextMenuItem>
      {!menu.isDirectory && (
        <ContextMenuItem onClick={act(() => void window.api.openPath(menu.path))}>
          <SquareArrowOutUpRight className="size-4" /> 在其他应用中打开
        </ContextMenuItem>
      )}
      {terminal && (
        <ContextMenuItem
          onClick={act(() => void useApp.getState().newTerminal(projectPath, nearestDir))}
        >
          <Terminal className="size-4" /> 在终端中打开
        </ContextMenuItem>
      )}
      {isRoot && onAscend !== undefined && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={onAscend === null}
            title={onAscend === null ? '已是最顶层文件夹' : undefined}
            onClick={act(() => onAscend?.())}
          >
            <CornerLeftUp className="size-4" /> 上一级文件夹
          </ContextMenuItem>
          {onAddProject !== undefined && (
            <ContextMenuItem onClick={act(onAddProject)}>
              {projectRegistered ? (
                <>
                  <FolderSymlink className="size-4" /> 转到项目
                </>
              ) : (
                <>
                  <FolderPlus className="size-4" /> 添加为项目
                </>
              )}
            </ContextMenuItem>
          )}
        </>
      )}
      {onSetRoot !== undefined && !isRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={act(() => onSetRoot(nearestDir))}>
            <CornerRightDown className="size-4" /> 进入此文件夹
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={act(() => void window.api.filesCopyFile(toSysPath(menu.path)))}>
        <Files className="size-4" /> {menu.isDirectory ? '复制文件夹' : '复制文件'}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => copyText(menu.path)}>
        <Copy className="size-4" /> 复制路径
      </ContextMenuItem>
      {!isRoot && (
        <ContextMenuItem onClick={() => copyText(relPathUnderRoot(projectRoot, menu.path))}>
          <Copy className="size-4" /> 复制相对路径
        </ContextMenuItem>
      )}
    </>
  )

  return (
    <ContextMenu
      open
      onOpenChange={(open, details) => {
        if (open) return
        closeReason.current = details.reason
        onClose()
      }}
    >
      <ContextMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={2}
        finalFocus={() => closeReason.current !== 'item-press'}
      >
        <ContextMenuItem onClick={() => request({ kind: 'create-file', dir: nearestDir })}>
          <FilePlus className="size-4" /> 新建文件
        </ContextMenuItem>
        <ContextMenuItem onClick={() => request({ kind: 'create-dir', dir: nearestDir })}>
          <FolderPlus className="size-4" /> 新建文件夹
        </ContextMenuItem>
        <ContextMenuSeparator />
        {serverItems}
        {localItems}
        {!isRoot && (
          <>
            <ContextMenuSeparator />
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
                request({
                  // 服务器上没有回收站：删了即不可恢复
                  kind: server !== undefined ? 'delete' : 'trash',
                  path: menu.path,
                  isDirectory: menu.isDirectory
                })
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
