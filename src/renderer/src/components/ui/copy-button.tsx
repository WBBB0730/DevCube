// 就地复制钮（点完界面不变的复制钮）：复制到剪贴板，成功后图标换勾 1 秒（DESIGN.md「操作结果的反馈」的例外）；
// 连点从最后一次成功重新计时，失败不提示，同其他复制。
// 按需显示的钮（如悬停才出）传 `visible`：勾在期间不论 visible 都显示；勾收起时钮若该隐藏，就带着勾淡出，
// 等再次该显示（从透明渐显）时才换回复制图标，淡出途中不闪回。
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** 复制成功后勾停留的时长 */
const COPIED_MS = 1000

export function CopyButton({
  text,
  title,
  visible = true,
  className,
  iconClassName
}: {
  /** 要复制的文本 */
  text: string
  title: string
  /** 此刻该不该显示（不传即常显）；隐藏为透明，渐隐渐显由 `className` 的过渡决定 */
  visible?: boolean
  className?: string
  /** 复制图标与勾共用：尺寸、颜色 */
  iconClassName?: string
}): React.JSX.Element {
  /** 最近一次复制成功的时刻；勾收起后为 null */
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  useEffect(() => {
    if (copiedAt === null) return
    const timer = setTimeout(() => setCopiedAt(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copiedAt])
  const copied = copiedAt !== null
  /** 图标是勾：复制成功起，到勾收起且钮该显示时止 */
  const [check, setCheck] = useState(false)
  if (copied && !check) setCheck(true)
  else if (!copied && check && visible) setCheck(false)
  return (
    <button
      type="button"
      title={title}
      className={cn(className, !visible && !copied && 'opacity-0')}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setCopiedAt(Date.now()))
          .catch(() => undefined)
      }}
    >
      {check ? <Check className={iconClassName} /> : <Copy className={iconClassName} />}
    </button>
  )
}
