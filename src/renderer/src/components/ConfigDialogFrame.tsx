import { useEffect } from 'react'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'

/**
 * 配置对话框的外壳（命令配置与数据源上的配置共用）：SettingsModal、底栏「取消 / 保存」、Esc 关闭。
 * 保存只在 valid 时可点。
 */
export function ConfigDialogFrame({
  title,
  className,
  valid,
  onClose,
  onSubmit,
  children
}: {
  title: string
  /** 外框宽度等 */
  className: string
  valid: boolean
  onClose: () => void
  onSubmit: () => void
  /** 各字段（Field） */
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 编辑器里的 Esc 先由它收下（关补全、关查找栏），不关对话框
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <SettingsModal
      title={title}
      onClose={onClose}
      className={className}
      footer={
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--separator)] px-4 py-2.5">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={onSubmit} disabled={!valid}>
            保存
          </Button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">{children}</div>
    </SettingsModal>
  )
}

export function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  // 不用 <label> 包整块：内含按钮时点击会被标签关联吃掉（删环境变量无反应）。
  return (
    <div className="block">
      <div className="mb-1.5 text-[12px] font-medium text-foreground">{label}</div>
      {children}
    </div>
  )
}
