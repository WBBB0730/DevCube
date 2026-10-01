// 栏里的小数字输入框（Files 分页预览的页码等）：h-6、`--border-input` 描边、居中 12px 数字（等宽数位）；
// 聚焦全选、只压深底色不描亮边（同树顶筛选框）。改的是草稿：回车（排除输入法合成）提交并失焦，Esc 或失焦即放弃、显示回当前值。
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'

export function NumberInput({
  value,
  onCommit,
  title,
  className
}: {
  value: number
  /** 回车提交草稿转成的数（没改过、不是数不提交）；取整、夹紧与校验由调用方做 */
  onCommit: (value: number) => void
  title?: string
  /** 宽度等（如 `w-9`） */
  className?: string
}): React.JSX.Element {
  /** 正在编辑的草稿；null = 显示当前值 */
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          // 没改过就只失焦（否则 Number(null) 落成 0）
          const n = Number(draft)
          if (draft !== null && Number.isFinite(n)) onCommit(n)
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.blur()
        }
      }}
      inputMode="numeric"
      title={title}
      className={cn(
        'h-6 shrink-0 rounded border border-[var(--border-input)] bg-transparent text-center text-[12px] text-foreground tabular-nums transition-colors outline-none focus:bg-[var(--bg-row-hover)]',
        className
      )}
    />
  )
}
