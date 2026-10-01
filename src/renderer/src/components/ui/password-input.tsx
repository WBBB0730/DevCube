// 密码输入框：Input + 框内右侧「显示 / 隐藏」切换（Eye / EyeOff）。
// 切换钮拦掉鼠标按下与松开的默认行为：按下不抢焦点，松开不让浏览器按鼠标位置重置选区——
// 光标与选区因此原样留在输入框里（改 type 本身不动光标；同 Ant Design Input.Password 的做法）。
// 不进 Tab 序，免得焦点落到它身上时回车被对话框当成「确定」。
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'

function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={cn('pr-8', className)}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        title={visible ? '隐藏' : '显示'}
        onMouseDown={(e) => e.preventDefault()}
        onMouseUp={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}

export { PasswordInput }
