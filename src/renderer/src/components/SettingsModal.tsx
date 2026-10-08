import type { ReactNode } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * 底栏。默认「确定」（主色）；
   * 传 `null` 可去掉底栏。
   */
  footer?: ReactNode | null
  /** 点遮罩即关闭：只给没有文本输入的弹层（应用设置） */
  dismissOnOutsidePress?: boolean
  /** 外框尺寸等，由调用方指定 */
  className?: string
}

function DefaultFooter({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--separator)] px-4 py-2.5">
      <Button type="button" size="sm" onClick={onClose}>
        确定
      </Button>
    </div>
  )
}

/**
 * 设置类弹层共用外壳：建在 ui/dialog 上（Esc 关闭，关闭规则见那里）——rounded-dialog（10px，对齐 macOS 窗口圆角）
 * 面板 + 居中加粗标题 + 底栏。
 */
export function SettingsModal({
  title,
  onClose,
  children,
  footer,
  dismissOnOutsidePress = false,
  className
}: Props): React.JSX.Element {
  const bar = footer === null ? null : (footer ?? <DefaultFooter onClose={onClose} />)

  return (
    <Dialog
      onClose={onClose}
      dismissOnOutsidePress={dismissOnOutsidePress}
      className={cn('flex flex-col overflow-hidden', className)}
    >
      <div className="shrink-0 border-b px-4 py-2.5 text-center text-[13px] font-bold text-[color:var(--fg-dialog-title)]">
        {title}
      </div>
      {children}
      {bar}
    </Dialog>
  )
}
