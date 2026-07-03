// Base UI RadioGroup 封装（vendored shadcn 风格）：纵向单选组；圆点 16px，选中态 primary 实心点。
// 文字标签由调用方用 <label> 包裹 RadioGroupItem。
import { RadioGroup as BaseRadioGroup } from '@base-ui-components/react/radio-group'
import { Radio } from '@base-ui-components/react/radio'
import { cn } from '@renderer/lib/utils'

function RadioGroup({
  className,
  value,
  onValueChange,
  children
}: {
  className?: string
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseRadioGroup
      className={cn('flex flex-col gap-2', className)}
      value={value}
      // Base UI 的 value 泛化为 unknown；本封装只用字符串值
      onValueChange={(next) => onValueChange?.(next as string)}
    >
      {children}
    </BaseRadioGroup>
  )
}

function RadioGroupItem({
  className,
  value,
  disabled
}: {
  className?: string
  value: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Radio.Root
      value={value}
      disabled={disabled}
      className={cn(
        'flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[color:var(--border-input)] bg-[var(--bg-panel)] outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[checked]:border-[color:var(--primary)]',
        className
      )}
    >
      <Radio.Indicator className="flex">
        <span className="size-2 rounded-full bg-primary" />
      </Radio.Indicator>
    </Radio.Root>
  )
}

export { RadioGroup, RadioGroupItem }
