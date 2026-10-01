// Base UI Checkbox 封装（vendored shadcn 风格，样式对齐 components/ui/ 既有四件）：
// 16px 方框，选中态 primary 底 + 白色 √；文字标签由调用方用 <label className={CHOICE_ROW}> 包裹。
import { Checkbox as BaseCheckbox } from '@base-ui-components/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** 勾选行 / 单选行的 label：勾选框（或单选圆点）+ 文字，13px 正文色，整行可点 */
export const CHOICE_ROW =
  'flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground'

/**
 * 勾选框的方框（Checkbox 与多选下拉的选项共用，见 ui/combobox）：16px、描边、elevated 底；勾上时 primary 底、描边同色，
 * 各自按自己的 data 属性加上
 */
export const CHECKBOX_BOX =
  'flex size-4 shrink-0 items-center justify-center rounded border border-[color:var(--border-input)] bg-[var(--bg-elevated)]'

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
        CHECKBOX_BOX,
        'cursor-pointer outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[checked]:border-[color:var(--primary)] data-[checked]:bg-primary',
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
