// 通用小对话框外壳（“Git 对话框族”样式的单一定义源，抽取自 GitDialogs）：建在 ui/dialog 上，
// 440px 面板 +「提示语 + 内容 + 底部按钮条（右对齐）」。弹窗内不画分割线，靠留白分区。
// 无标题栏——13px 提示语即说明；Enter = 主按钮（防输入法合成回车）、Esc = 取消（关闭规则见 ui/dialog）。
// GitDialogs 与 Files 的弹窗（新建 / 重命名 / 删除 / 磁盘冲突）共用。
// 另有仿 WebStorm 消息框的一族（错误框、确认框）：左侧大图标 + 加粗标题 + 正文，见 MessageBox。
import { useRef } from 'react'
import { CircleAlert, CircleQuestionMark, Info, TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'

/** 底部按钮条：右对齐，不画分割线——与正文之间只靠正文的下内边距隔开。 */
export function DialogFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex justify-end gap-2 px-4 pb-4">{children}</div>
}

/**
 * 消息框的正文版式（仿 WebStorm，错误框与确认框共用）：左侧 32px 图标；右侧加粗标题 + 正文（可选中、保留换行、
 * 限高滚动）；children 是正文之下的附加内容（指纹、出错原因等），与正文左缘对齐。
 */
function MessageBox({
  icon,
  title,
  message,
  children
}: {
  icon: React.ReactNode
  title: string
  message?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="break-words text-[13px] font-semibold text-foreground">{title}</div>
        {message !== undefined && (
          <div className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
            {message}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/**
 * 错误框（仿 WebStorm 的错误提示）：左侧 32px 红色错误图标；右侧加粗标题（默认「操作失败」）+
 * 普通字体正文；右下只有「确定」，点遮罩、Esc 同「确定」。打开即聚焦「确定」，回车即关闭。
 */
export function ErrorDialog({
  title = '操作失败',
  message,
  onClose
}: {
  title?: string
  message: string
  onClose: () => void
}): React.JSX.Element {
  const okRef = useRef<HTMLButtonElement>(null)

  // 按住不放的连续回车不算（同 FormDialogShell）：免得弹出前按下的一次长按落到刚聚焦的「确定」上，一闪就关
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && e.repeat) e.preventDefault()
  }

  return (
    <Dialog
      onClose={onClose}
      dismissOnOutsidePress
      initialFocus={() => okRef.current}
      onKeyDown={onKeyDown}
    >
      <div className="px-4 py-4">
        <MessageBox
          icon={<CircleAlert className="size-8 shrink-0 text-[color:var(--status-failed)]" />}
          title={title}
          message={message}
        />
      </div>
      <DialogFooter>
        <Button ref={okRef} onClick={onClose}>
          确定
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** 字段旁的说明图标（hover 出 title）。 */
export function InfoIcon({ text }: { text: string }): React.JSX.Element {
  return (
    <span title={text} className="flex shrink-0 items-center">
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

type FormDialogShellProps = {
  message: React.ReactNode
  children?: React.ReactNode
  buttons: FormDialogButton[]
  onCancel: () => void
  cancelLabel?: string
  cancelDisabled?: boolean
  hideCancel?: boolean
  dismissible?: boolean
  dismissOnOutsidePress?: boolean
  /** 打开时聚焦的元素（见 ui/dialog）；缺省为面板本身，回车即主按钮 */
  initialFocus?: () => HTMLElement | null
  footerStart?: React.ReactNode
  /** 面板尺寸覆盖（默认 440px 宽） */
  className?: string
}

/**
 * 自定义表单对话框外壳：消息 + children（字段自由布局）+ 按钮行。
 * buttons[0] 为主按钮（Enter 触发）；取消钮文案与禁用可定制（忙碌中锁死弹窗，Esc 随之失效），
 * hideCancel 不显示取消钮（几颗按钮都是动作；Esc 仍是取消）。
 * dismissOnOutsidePress：点遮罩即取消，只给没有文本输入的对话框（确认类）。
 * dismissible=false：遮罩点击与 Esc 都不收口（长任务进行中，只认明确点按钮），
 * 与 cancelDisabled 正交——取消钮仍可用。
 * 叠在它之上的对话框（错误框、确认框）写在 children 里（嵌套对话框，见 ui/dialog）。
 * footerStart：底栏左侧的辅助动作（如「测试连接」），与右侧的取消 / 主按钮分开。
 */
export function FormDialogShell({
  message,
  children,
  buttons,
  onCancel,
  cancelLabel = '取消',
  cancelDisabled = false,
  hideCancel = false,
  dismissible = true,
  dismissOnOutsidePress = false,
  initialFocus,
  footerStart,
  className
}: FormDialogShellProps): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Enter = 主按钮；必须排除输入法合成中的回车（isComposing / keyCode 229）
    if (e.key !== 'Enter') return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // 叠在上面的对话框冒泡上来的回车归它自己
    if (!e.currentTarget.contains(e.target as Node)) return
    // 按住不放的连续回车不算：免得一次长按在提交之后又落到随即弹出的确认框上
    if (e.repeat) {
      e.preventDefault()
      return
    }
    // 焦点在按钮上时回车交给按钮自己：「取消」就是取消、「测试连接」就是测试，不都变成主按钮
    if (e.target instanceof HTMLButtonElement) return
    const primary = buttons[0]
    if (primary === undefined || primary.disabled === true) return
    e.preventDefault()
    primary.onClick()
  }

  return (
    <Dialog
      onClose={onCancel}
      dismissible={dismissible && !cancelDisabled}
      dismissOnOutsidePress={dismissOnOutsidePress}
      initialFocus={initialFocus}
      className={className}
      onKeyDown={onKeyDown}
    >
      <div className="space-y-3 px-4 py-4">
        <div className="select-text text-[13px] leading-relaxed text-foreground">{message}</div>
        {children}
      </div>
      <DialogFooter>
        {footerStart !== undefined && (
          <div className="mr-auto flex items-center gap-2">{footerStart}</div>
        )}
        {!hideCancel && (
          <Button variant="ghost" disabled={cancelDisabled} onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
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
      </DialogFooter>
    </Dialog>
  )
}

/**
 * 确认框（仿 WebStorm 的询问框，与错误框同一版式）：不带输入、只问做不做（或在几个动作里选一个）的对话框一律用它。
 * 左侧 32px 图标：主按钮是危险操作时为红色警告三角，否则为蓝色问号；右侧加粗标题（问句）+ 正文（会发生什么，
 * 可省）+ 附加内容（children）；按钮、取消与底栏左侧
 * 同小对话框（buttons[0] 为主按钮，回车即触发）。没有文本输入，Esc、点遮罩即取消。
 */
export function ConfirmDialog({
  title,
  message,
  children,
  ...shell
}: {
  title: string
  message?: React.ReactNode
  children?: React.ReactNode
} & Pick<
  FormDialogShellProps,
  | 'buttons'
  | 'onCancel'
  | 'cancelLabel'
  | 'cancelDisabled'
  | 'hideCancel'
  | 'footerStart'
  | 'className'
>): React.JSX.Element {
  return (
    <FormDialogShell
      message={
        <MessageBox
          icon={
            shell.buttons[0]?.destructive === true ? (
              <TriangleAlert className="size-8 shrink-0 text-[color:var(--status-failed)]" />
            ) : (
              <CircleQuestionMark className="size-8 shrink-0 text-primary" />
            )
          }
          title={title}
          message={message}
        >
          {children}
        </MessageBox>
      }
      dismissOnOutsidePress
      {...shell}
    />
  )
}
