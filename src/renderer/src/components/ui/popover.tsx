import { Popover as BasePopover } from '@base-ui-components/react/popover'
import { cn } from '@renderer/lib/utils'

const Popover = BasePopover.Root
const PopoverTrigger = BasePopover.Trigger

function PopoverContent({
  className,
  children,
  anchor,
  initialFocus,
  finalFocus,
  side = 'bottom',
  align = 'start',
  sideOffset = 4
}: {
  className?: string
  children?: React.ReactNode
  /** 虚拟锚点（如行号格子矩形）；缺省锚在 Trigger 上 */
  anchor?: { getBoundingClientRect: () => DOMRect }
  /** 打开时焦点去哪；缺省移进弹层（第一个可聚焦的元素） */
  initialFocus?: React.ComponentProps<typeof BasePopover.Popup>['initialFocus']
  /** 关闭后焦点去哪；缺省回到 Trigger */
  finalFocus?: React.ComponentProps<typeof BasePopover.Popup>['finalFocus']
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}): React.JSX.Element {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        className="z-50"
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <BasePopover.Popup
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          className={cn(
            'max-h-72 min-w-56 overflow-auto rounded-lg border border-[color:var(--border-input)] bg-elevated p-1.5 shadow-xl outline-none',
            className
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
