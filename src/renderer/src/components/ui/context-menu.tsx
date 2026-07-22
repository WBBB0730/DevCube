import { ContextMenu as BaseContextMenu } from '@base-ui-components/react/context-menu'
import { cn } from '@renderer/lib/utils'

const ContextMenu = BaseContextMenu.Root
const ContextMenuTrigger = BaseContextMenu.Trigger

const MENU_ITEM =
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-[var(--bg-row-hover)] data-[disabled]:cursor-default data-[disabled]:opacity-50'

/** 与 DropdownMenuContent 同视觉；定位交给 ContextMenu（锚在右键点或传入的虚拟 anchor）。 */
function ContextMenuContent({
  className,
  children,
  anchor,
  side,
  align,
  sideOffset,
  alignOffset,
  collisionPadding
}: {
  className?: string
  children?: React.ReactNode
  /** 虚拟锚点（如 store 记下的右键坐标）；缺省用 Trigger 写入的 context anchor */
  anchor?: { getBoundingClientRect: () => DOMRect }
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  alignOffset?: number
  collisionPadding?: number
}): React.JSX.Element {
  return (
    <BaseContextMenu.Portal>
      {/* 官方 Backdrop：盖过左树 sticky（z≤40），避免吸顶行浮在遮罩之上 */}
      <BaseContextMenu.Backdrop className="fixed inset-0 z-50" />
      <BaseContextMenu.Positioner
        className="z-50"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <BaseContextMenu.Popup
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
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

function ContextMenuItem({
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
    <BaseContextMenu.Item
      className={cn(MENU_ITEM, className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </BaseContextMenu.Item>
  )
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem }
