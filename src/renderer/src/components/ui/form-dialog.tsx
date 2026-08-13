// 通用小对话框外壳（“Git 对话框族”样式的单一定义源，抽取自 GitDialogs）：
// Mask 遮罩 + 440px 面板 +「提示语 + 内容 + 底部按钮条（border-t 分隔、右对齐）」。
// 无标题栏——13px 提示语即说明；Enter = 主按钮（防输入法合成回车）、Esc = 取消。
// GitDialogs 与 Files 的弹窗（新建 / 重命名 / 删除 / 磁盘冲突）共用。
import { useEffect } from 'react'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
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
        'w-[440px] rounded-dialog border border-[color:var(--border-input)] bg-panel shadow-xl',
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
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
}

/**
 * 自定义表单对话框外壳：Mask + DialogPanel + 消息 + children（字段自由布局）+ 按钮行。
 * buttons[0] 为主按钮（Enter 触发）；取消钮文案与禁用可定制（忙碌中锁死弹窗）。
 */
export function FormDialogShell({
  message,
  children,
  buttons,
  onCancel,
  cancelLabel = '取消',
  cancelDisabled = false
}: {
  message: React.ReactNode
  children?: React.ReactNode
  buttons: FormDialogButton[]
  onCancel: () => void
  cancelLabel?: string
  cancelDisabled?: boolean
}): React.JSX.Element {
  // Escape 兜底：焦点在对话框输入控件里时外层 capture 监听会让位，这里补一份
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

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
    <DialogMask onClick={cancelDisabled ? undefined : onCancel}>
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
