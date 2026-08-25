// JetBrains New UI SegmentedButton 的等价物：一组互斥分段按钮。
// 选中态纯靠底色表达（--selection-row，同左树选中行），段上不描边——JetBrains 那几个
// SegmentedButton.* 键只服务这一个控件，不值得在全局 token 里单占。
// 语义走 Base UI Radio 而非 ToggleGroup——后者单选态下再点一次已选项会取消，落到「一个都没选」
// （ToggleGroup.js 的 `nextPressed ? [newValue] : []`），不适合必选项；Radio 还自带方向键切换。
import { RadioGroup as BaseRadioGroup } from '@base-ui-components/react/radio-group'
import { Radio } from '@base-ui-components/react/radio'
import { cn } from '@renderer/lib/utils'

function SegmentedControl({
  className,
  value,
  onValueChange,
  items
}: {
  className?: string
  value?: string
  onValueChange?: (value: string) => void
  items: { value: string; label: string; disabled?: boolean }[]
}): React.JSX.Element {
  return (
    <BaseRadioGroup
      className={cn(
        'inline-flex h-8 items-stretch gap-px rounded-lg border border-[color:var(--border-input)] bg-[var(--bg-panel)] p-px',
        className
      )}
      value={value}
      // Base UI 的 value 泛化为 unknown；本封装只用字符串值（同 RadioGroup）
      onValueChange={(next) => onValueChange?.(next as string)}
    >
      {items.map((item) => (
        <Radio.Root
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          className="flex cursor-pointer select-none items-center rounded px-4 text-[13px] text-foreground outline-none transition-colors hover:bg-[var(--bg-row-hover)] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[checked]:bg-[var(--selection-row)] data-[checked]:hover:bg-[var(--selection-row)]"
        >
          {item.label}
        </Radio.Root>
      ))}
    </BaseRadioGroup>
  )
}

export { SegmentedControl }
