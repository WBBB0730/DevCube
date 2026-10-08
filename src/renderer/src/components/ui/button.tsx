import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        // 灰底次要按钮：正文区占位里的动作（下载、在其他应用中打开、重试等）
        secondary: 'bg-secondary text-secondary-foreground hover:bg-[var(--bg-button-hover)]',
        ghost: 'text-foreground hover:bg-[var(--bg-row-hover)]',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // 弱危险：淡红底 + 红字，用于常驻页面、不需要抢眼的危险动作（如状态页的「断开连接」）
        destructiveSoft: 'bg-destructive/10 text-destructive hover:bg-destructive/20'
      },
      size: {
        default: 'h-8 px-3.5',
        sm: 'h-7 px-2.5',
        icon: 'size-7'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
