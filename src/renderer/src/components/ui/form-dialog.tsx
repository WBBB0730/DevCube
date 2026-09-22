// 通用小对话框外壳（“Git 对话框族”样式的单一定义源，抽取自 GitDialogs）：
// Mask 遮罩 + 440px 面板 +「提示语 + 内容 + 底部按钮条（border-t 分隔、右对齐）」。
// 无标题栏——13px 提示语即说明；Enter = 主按钮（防输入法合成回车）、Esc = 取消。
// GitDialogs 与 Files 的弹窗（新建 / 重命名 / 删除 / 磁盘冲突）共用。
import { useEffect } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

export function DialogMask({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--mask)]"
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** 对话框面板外壳：440px 宽（ConfigDialog 同款），拦截冒泡防误触遮罩关闭。 */
export function DialogPanel({
  children,
  className,
  onKeyDown
}: {
  children: React.ReactNode
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'w-[440px] rounded-dialog border border-[color:var(--border-input)] bg-elevated shadow-xl',
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

/** 字段旁的说明图标（hover 出 title）。 */
export function InfoIcon({ text }: { text: string }): React.JSX.Element {
  return (
    <span title={text} className="flex shrink-0 cursor-help items-center">
      <Info className="size-3.5 text-muted-foreground" />
    </span>
  )
}

/** 表单字段行：12px 标签（可带说明图标）+ 下方控件。 */
export function FieldRow({
  label,
  info,
  children
}: {
  label: string
  info?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        {info !== undefined && <InfoIcon text={info} />}
      </div>
      {children}
    </div>
  )
}

export interface FormDialogButton {
  label: string
  onClick: () => void
  disabled?: boolean
  /** 悬停说明（常用于解释禁用原因） */
  title?: string
  /** 危险操作（删除等不可逆动作）：主按钮用 destructive 变体 */
  destructive?: boolean
}

/**
 * 自定义表单对话框外壳：Mask + DialogPanel + 消息 + children（字段自由布局）+ 按钮行。
 * buttons[0] 为主按钮（Enter 触发）；取消钮文案与禁用可定制（忙碌中锁死弹窗）。
 * dismissible=false：遮罩点击与 Esc 都不收口（长任务进行中，只认明确点按钮），
 * 与 cancelDisabled 正交——取消钮仍可用。
 */
export function FormDialogShell({
  message,
  children,
  buttons,
  onCancel,
  cancelLabel = '取消',
  cancelDisabled = false,
  dismissible = true
}: {
  message: React.ReactNode
  children?: React.ReactNode
  buttons: FormDialogButton[]
  onCancel: () => void
  cancelLabel?: string
  cancelDisabled?: boolean
  dismissible?: boolean
}): React.JSX.Element {
  // Escape 兜底：焦点在对话框输入控件里时外层 capture 监听会让位，这里补一份
  useEffect(() => {
    if (!dismissible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, dismissible])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Enter = 主按钮；必须排除输入法合成中的回车（isComposing / keyCode 229）
    if (e.key !== 'Enter') return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const primary = buttons[0]
    if (primary === undefined || primary.disabled === true) return
    e.preventDefault()
    primary.onClick()
  }

  return (
    <DialogMask onClick={cancelDisabled || !dismissible ? undefined : onCancel}>
      <DialogPanel onKeyDown={onKeyDown}>
        <div className="space-y-3 px-4 py-4">
          <div className="select-text text-[13px] leading-relaxed text-foreground">{message}</div>
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" disabled={cancelDisabled} onClick={onCancel}>
            {cancelLabel}
          </Button>
          {buttons.map((btn, i) => (
            <Button
              key={i}
              variant={btn.destructive === true ? 'destructive' : 'default'}
              disabled={btn.disabled === true}
              title={btn.title}
              onClick={btn.onClick}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      </DialogPanel>
    </DialogMask>
  )
}
