import { Menu } from '@base-ui-components/react/menu'
import { cn } from '@renderer/lib/utils'

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger

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

function DropdownMenuItem({
  className,
  children,
  onClick
}: {
  className?: string
  children?: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  return (
    <Menu.Item
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-[var(--bg-row-hover)]',
        className
      )}
      onClick={onClick}
    >
      {children}
    </Menu.Item>
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
