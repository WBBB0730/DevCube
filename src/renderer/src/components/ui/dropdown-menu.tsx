import { Menu } from '@base-ui-components/react/menu'
import { ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger
const DropdownMenuSub = Menu.SubmenuRoot

function DropdownMenuContent({
  className,
  children,
  side = 'bottom',
  align = 'end',
  sideOffset = 4
}: {
  className?: string
  children?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}): React.JSX.Element {
  return (
    <Menu.Portal>
      {/* 盖过左树 sticky（z≤40）；仅靠 Positioner 的 z-50 盖不住 InternalBackdrop 之下的吸顶行 */}
      <Menu.Backdrop className="fixed inset-0 z-50" />
      <Menu.Positioner className="z-50" side={side} align={align} sideOffset={sideOffset}>
        <Menu.Popup
          className={cn(
            'min-w-32 rounded-lg border border-[color:var(--border-input)] bg-panel p-1.5 shadow-xl outline-none',
            className
          )}
          // Portal 仍走 React 树冒泡：拦住右键，避免落到下方行又开一层右键菜单。
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

const MENU_ITEM =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-[var(--bg-row-hover)] data-[disabled]:cursor-default data-[disabled]:opacity-50'

function DropdownMenuItem({
  className,
  children,
  onClick,
  disabled,
  title
}: {
  className?: string
  children?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <Menu.Item
      className={cn(MENU_ITEM, className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Menu.Item>
  )
}

function DropdownMenuSubTrigger({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <Menu.SubmenuTrigger
      className={cn(MENU_ITEM, 'data-[popup-open]:bg-[var(--bg-row-hover)]', className)}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-70" />
    </Menu.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  children,
  // 与一级菜单同侧间距；alignOffset 轻微上移对齐触发项。
  sideOffset = 4,
  alignOffset = -4
}: {
  className?: string
  children?: React.ReactNode
  sideOffset?: number
  alignOffset?: number
}): React.JSX.Element {
  return (
    <Menu.Portal>
      <Menu.Positioner
        className="z-50"
        side="right"
        align="start"
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <Menu.Popup
          className={cn(
            'min-w-32 rounded-lg border border-[color:var(--border-input)] bg-panel p-1.5 shadow-xl outline-none',
            className
          )}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
}
