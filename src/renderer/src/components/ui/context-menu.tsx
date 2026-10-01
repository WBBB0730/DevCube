import { useMemo } from 'react'
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
  collisionPadding,
  finalFocus
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
  /** 关闭后焦点去向（缺省还给右键前的焦点），见 Base UI `Menu.Popup` */
  finalFocus?: BaseContextMenu.Popup.Props['finalFocus']
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
          finalFocus={finalFocus}
          className={cn(
            'min-w-32 rounded-lg border border-[color:var(--border-input)] bg-elevated p-1.5 shadow-xl outline-none',
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

/**
 * 在鼠标点弹出的受控右键菜单（Files 树与正文、Git、数据源的树共用；不挂行级 Trigger）：锚在鼠标点的 0×0 矩形上，
 * 从它的右下方弹出，Base UI 负责翻转 / 贴边。调用方有菜单目标时才渲染它，只写菜单项。
 */
function PointContextMenu({
  at,
  onClose,
  finalFocus,
  children
}: {
  /** 鼠标点（视口坐标，即右键事件的 clientX / clientY） */
  at: { x: number; y: number }
  /** 菜单关掉（选了菜单项、Esc、点外面等），reason 为关闭原因 */
  onClose: (reason: BaseContextMenu.Root.ChangeEventReason) => void
  /** 同 ContextMenuContent */
  finalFocus?: BaseContextMenu.Popup.Props['finalFocus']
  children: React.ReactNode
}): React.JSX.Element {
  const { x, y } = at
  const anchor = useMemo(
    () => ({ getBoundingClientRect: (): DOMRect => new DOMRect(x, y, 0, 0) }),
    [x, y]
  )
  return (
    <ContextMenu
      open
      onOpenChange={(open, details) => {
        if (!open) onClose(details.reason)
      }}
    >
      <ContextMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={2}
        finalFocus={finalFocus}
      >
        {children}
      </ContextMenuContent>
    </ContextMenu>
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

function ContextMenuSeparator(): React.JSX.Element {
  return <div className="mx-1.5 my-1 h-px bg-[var(--border-input)]" role="separator" />
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  PointContextMenu,
  ContextMenuItem,
  ContextMenuSeparator
}
