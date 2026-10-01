// 未连上时的正文（服务器的状态 / 文件 Tab 等）：居中一句说明 + 按钮（「连接」/「重新连接」），
// 连接中换成转圈「正在连接…」。说明与按钮之间可插额外内容（如密码框）；这时整页作为 form，回车即按按钮。
import { Button } from '@renderer/components/ui/button'
import { LoadingHint } from '@renderer/components/ui/centered-hint'

export function ConnectPlaceholder({
  phase,
  message,
  actionLabel,
  onAction,
  form = false,
  children
}: {
  /** idle = 未连接（或其它一句话的说明），failed = 连接失败 / 已断开（说明为原因），connecting = 正在连接 */
  phase: 'idle' | 'connecting' | 'failed'
  /** 说明（如「尚未连接到 X」、失败原因）；连接中不显示 */
  message?: string
  /** 按钮文案（如「连接」「重新连接」）；不给即不出按钮 */
  actionLabel?: string
  onAction?: () => void
  /** 整页作为 form：按钮为提交钮，在插入的输入框里回车即 onAction */
  form?: boolean
  /** 说明与按钮之间的额外内容（如密码框与「记住密码」） */
  children?: React.ReactNode
}): React.JSX.Element {
  if (phase === 'connecting') return <LoadingHint label="正在连接…" delay={0} />
  const className =
    'flex h-full select-text flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground'
  const content = (
    <>
      {/* 失败原因可能多行、很长：原样换行、限宽居中 */}
      <span
        className={
          phase === 'failed' ? 'max-w-xl whitespace-pre-wrap break-words text-center' : undefined
        }
      >
        {message}
      </span>
      {children}
      {actionLabel !== undefined && (
        <Button type={form ? 'submit' : 'button'} onClick={form ? undefined : onAction}>
          {actionLabel}
        </Button>
      )}
    </>
  )
  return form ? (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        onAction?.()
      }}
    >
      {content}
    </form>
  ) : (
    <div className={className}>{content}</div>
  )
}
