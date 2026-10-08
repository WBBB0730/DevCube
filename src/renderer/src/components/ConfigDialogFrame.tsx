import { Info } from 'lucide-react'
import { SettingsModal } from '@renderer/components/SettingsModal'
import { Button } from '@renderer/components/ui/button'

/**
 * 配置对话框的外壳（命令配置与数据源上的配置共用）：SettingsModal、底栏左侧参数说明（hover 看格式与示例，
 * docs/prd/run-config-params.md）、右侧「取消 / 保存」。Esc 关闭（已被编辑器收下的不算），点遮罩不关。
 * 保存只在 valid 时可点。
 */
export function ConfigDialogFrame({
  title,
  className,
  paramExample,
  valid,
  onClose,
  onSubmit,
  children
}: {
  title: string
  /** 外框宽度等 */
  className: string
  /** 参数说明里的示例（按配置的内容写，如命令配置为一个命令行选项） */
  paramExample: string
  valid: boolean
  onClose: () => void
  onSubmit: () => void
  /** 各字段（Field） */
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <SettingsModal
      title={title}
      onClose={onClose}
      className={className}
      footer={
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--separator)] px-4 py-2.5">
          <span
            title={'格式：${{名称}}\n示例：' + paramExample}
            className="mr-auto flex cursor-default items-center gap-1 text-[12px] text-muted-foreground"
          >
            <Info className="size-3.5" />
            使用参数
          </span>
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
