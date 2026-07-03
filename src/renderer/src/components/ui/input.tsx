import { cn } from '@renderer/lib/utils'

function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-8 w-full rounded border border-[color:var(--border-input)] bg-[var(--bg-panel)] px-2.5 text-[13px] text-foreground outline-none transition placeholder:text-[color:var(--fg-disabled)] focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      {...props}
    />
  )
}

export { Input }
