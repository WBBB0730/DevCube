// 可输入也可选的输入框（Base UI Autocomplete 封装）：照常输入任意文字，也可从弹出的候选里选一个现成的值——聚焦（点进或
// Tab 移进来）或打字即弹出，按输入框里的文字筛选候选（空时列出全部），↑↓ 挑、回车选。外观同 Input（经 render 复用它），
// 不带下拉箭头（免得被当成 Select）；弹层与选项样式同 Select（ui/select）。
import { useState } from 'react'
import { Autocomplete } from '@base-ui-components/react/autocomplete'
import { Input } from '@renderer/components/ui/input'

export function AutocompleteInput({
  value,
  onChange,
  options,
  placeholder,
  className
}: {
  value: string
  onChange: (value: string) => void
  /** 候选的现成值；为空时就是普通输入框 */
  options: readonly string[]
  placeholder?: string
  /** 输入框补充样式（如 font-mono） */
  className?: string
}): React.JSX.Element {
  // 开合受控：Base UI 没有聚焦即打开的选项，聚焦时自己打开；其余开合（打字、点、Esc、选中、失焦）照 Base UI 的
  const [open, setOpen] = useState(false)
  return (
    <Autocomplete.Root
      items={options}
      value={value}
      onValueChange={(next) => onChange(next)}
      open={open}
      onOpenChange={(next) => setOpen(next)}
      // 已聚焦时（Esc 或选中收起之后）点输入框也打开；删空文字也不收起
      openOnInputClick
    >
      <Autocomplete.Input
        render={<Input className={className} />}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
      />
      <Autocomplete.Portal>
        {/* 输入的文字筛不出选项时不出弹层（没用 Autocomplete.Empty 时照 Base UI 的说明用 CSS 藏起来） */}
        <Autocomplete.Positioner
          className="z-50 data-[empty]:hidden"
          side="bottom"
          align="start"
          sideOffset={4}
        >
          <Autocomplete.Popup className="max-h-72 min-w-[var(--anchor-width)] overflow-auto rounded-lg border border-[color:var(--border-input)] bg-elevated p-1.5 shadow-xl outline-none">
            <Autocomplete.List>
              {(option: string) => (
                <Autocomplete.Item
                  key={option}
                  value={option}
                  className="flex cursor-pointer select-none items-center rounded px-1.5 py-1.5 text-[13px] text-foreground outline-none data-[highlighted]:bg-[var(--bg-row-hover)]"
                >
                  {option}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
