// Base UI Select 封装（vendored shadcn 风格，弹层样式照抄 dropdown-menu / popover：
// Portal + Positioner z-50 + Popup bg-panel/border-input/rounded-lg）。
// Root/Value 直接透传：多选（multiple）与自定义选中值展示（Value 的函数 children）都经它们使用。
import { Select as BaseSelect } from '@base-ui-components/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const Select = BaseSelect.Root
const SelectValue = BaseSelect.Value

function SelectTrigger({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseSelect.Trigger
      className={cn(
        'flex h-8 w-full cursor-pointer select-none items-center justify-between gap-1.5 rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] px-2.5 text-left text-[13px] text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {children}
      </span>
      <BaseSelect.Icon className="flex shrink-0">
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

function SelectContent({
  className,
  children
}: {
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseSelect.Portal>
      {/* 对齐触发器下方展开（关闭 Base UI 默认的「选中项对齐触发器」覆盖式定位） */}
      <BaseSelect.Positioner
        className="z-50"
        side="bottom"
        align="start"
        sideOffset={4}
        alignItemWithTrigger={false}
      >
        <BaseSelect.Popup
          className={cn(
            'max-h-72 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-[color:var(--border-input)] bg-panel p-1.5 shadow-xl outline-none',
            className
          )}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

function SelectItem({
  className,
  value,
  disabled,
  children
}: {
  className?: string
  value: string
  disabled?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseSelect.Item
      value={value}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer select-none items-center gap-1.5 rounded px-1.5 py-1.5 text-[13px] text-foreground outline-none data-[highlighted]:bg-[var(--bg-row-hover)] data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[disabled]:text-[color:var(--fg-disabled)] data-[disabled]:opacity-50',
        className
      )}
    >
      {/* 选中指示：未选中时保留 16px 占位列，选项文字纵向对齐 */}
      <span className="flex size-4 shrink-0 items-center justify-center">
        <BaseSelect.ItemIndicator className="flex">
          <Check className="size-3.5" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText className="min-w-0 flex-1">{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  )
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem }
