// Base UI Checkbox 封装（vendored shadcn 风格，样式对齐 components/ui/ 既有四件）：
// 16px 方框，选中态 primary 底 + 白色 √；文字标签由调用方用 <label> 包裹。
import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

function Checkbox({
  className,
  checked,
  disabled,
  onCheckedChange
}: {
  className?: string
  checked?: boolean
  disabled?: boolean
  onCheckedChange?: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <BaseCheckbox.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      className={cn(
        'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[checked]:border-[color:var(--primary)] data-[checked]:bg-primary',
        className
      )}
    >
      {/* Indicator 仅在选中时挂载，无需按 data 态隐藏 */}
      <BaseCheckbox.Indicator className="flex text-primary-foreground">
        <Check className="size-3" strokeWidth={3} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}

export { Checkbox }
