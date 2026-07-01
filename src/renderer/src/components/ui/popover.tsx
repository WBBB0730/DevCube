import { Popover as BasePopover } from '@base-ui-components/react/popover'
import { cn } from '@renderer/lib/utils'

const Popover = BasePopover.Root
const PopoverTrigger = BasePopover.Trigger

function PopoverContent({
  className,
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4
}: {
  className?: string
  children?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}): React.JSX.Element {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className="z-50" side={side} align={align} sideOffset={sideOffset}>
        <BasePopover.Popup
          className={cn(
            'max-h-72 min-w-56 overflow-auto rounded-xl border border-[color:var(--border-input)] bg-panel py-1 shadow-xl outline-none',
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
