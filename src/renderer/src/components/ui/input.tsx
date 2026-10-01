import { cn } from '@renderer/lib/utils'

/** 输入框旁的图标钮（32px，与 Input 同高、同行居中）：选择文件 / 目录钮，表单列表里挨着输入框的删除钮。 */
export const INPUT_ICON_BTN =
  'flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

function Input({ className, ...props }: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-elevated)] px-2.5 text-[13px] text-foreground outline-none transition placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
}

export { Input }
