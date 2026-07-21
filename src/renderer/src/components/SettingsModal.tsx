import type { ReactNode } from 'react'
import { Button } from '@renderer/components/ui/button'
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
  /** 外框尺寸等；默认不含宽高，由调用方指定 */
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
 * 设置类弹层共用外壳：遮罩 + rounded-xl 面板 + 居中加粗标题 + 底栏。
 * Esc / 点遮罩关闭由调用方自行挂键；点面板不冒泡。
 */
export function SettingsModal({
  title,
  onClose,
  children,
  footer,
  className
}: Props): React.JSX.Element {
  const bar = footer === null ? null : (footer ?? <DefaultFooter onClose={onClose} />)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-xl border border-[color:var(--border-input)] bg-panel shadow-xl',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b px-4 py-2.5 text-center text-[13px] font-bold text-[color:var(--fg-dialog-title)]">
          {title}
        </div>
        {children}
        {bar}
      </div>
    </div>
  )
}
