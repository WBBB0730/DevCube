// 目录与 Redis 键列表的右键菜单：同 Files 树菜单的做法（FilesTreeMenu），在鼠标点弹出（PointContextMenu，
// 非行级 Trigger），菜单打开期间目标行保持 hover 底（由树按 rowKey 给 TreeRow 的 menuActive）。
// 目录的各行（含根行）有「在控制台中打开」，对象行另有「复制名称」，两者之间隔一条分隔线（同 Files 树菜单：打开在前、
// 复制在后）；Redis 键行只有「复制键名」、文件夹行只有「复制前缀」。
import { useRef } from 'react'
import { Copy, SquareTerminal } from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  PointContextMenu
} from '@renderer/components/ui/context-menu'

export interface DataSourceTreeMenuTarget {
  x: number
  y: number
  /** 目标行的键 */
  rowKey: string
  /** 复制：菜单项文字（如「复制名称」）与要复制的文字；不给即没有这一项 */
  copy?: { label: string; text: string }
}

export function DataSourceTreeMenu({
  menu,
  onOpenConsole,
  consoleDisabled = false,
  consoleDisabledReason,
  onClose
}: {
  menu: DataSourceTreeMenuTarget | null
  /** 「在控制台中打开」（目录的各行）：点了要做的；不给即没有这一项 */
  onOpenConsole?: () => void
  /** 「在控制台中打开」置灰（控制台正在执行或正在切换上下文，或控制台上下文还不知道） */
  consoleDisabled?: boolean
  /** 置灰时 hover 的说明 */
  consoleDisabledReason?: string
  onClose: () => void
}): React.JSX.Element | null {
  /**
   * 选了「在控制台中打开」的那一次菜单（按目标认）：焦点交给控制台的编辑器，关菜单时不还给右键前的焦点（还焦点在微任务
   * 里，会把它抢走，同 FilesTreeMenu）；复制照旧还
   */
  const handedOff = useRef<DataSourceTreeMenuTarget | null>(null)
  if (menu === null) return null
  const { copy } = menu
  return (
    <PointContextMenu at={menu} onClose={onClose} finalFocus={() => handedOff.current !== menu}>
      {onOpenConsole !== undefined && (
        <ContextMenuItem
          disabled={consoleDisabled}
          title={consoleDisabled ? consoleDisabledReason : undefined}
          onClick={() => {
            handedOff.current = menu
            onClose()
            onOpenConsole()
          }}
        >
          <SquareTerminal className="size-4" /> 在控制台中打开
        </ContextMenuItem>
      )}
      {onOpenConsole !== undefined && copy !== undefined && <ContextMenuSeparator />}
      {copy !== undefined && (
        <ContextMenuItem
          onClick={() => {
            onClose()
            navigator.clipboard.writeText(copy.text).catch(() => undefined)
          }}
        >
          <Copy className="size-4" /> {copy.label}
        </ContextMenuItem>
      )}
    </PointContextMenu>
  )
}
