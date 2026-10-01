// 栏里的低调输入框（Files 树顶的筛选 /「前往路径」等）：透明底、聚焦时才压 `--bg-row-hover` 底，前面可放图标。
// 两种模式：即时模式（边输边生效，如筛选）有内容时末尾出「清空」；提交模式（给 onSubmit，回车才生效，如前往路径）
// 有内容时末尾依次出「提交」与「清空」。末尾钮按下时都不抢输入框的焦点——点「提交」同回车，「清空」后可接着输入。
// Esc 离开输入框：先同「清空」一样清空（已生效的筛选随之取消），再把焦点交给下面的树 / 列表（同 typeToInput 反过来），
// 它这一刻不在就只失焦；Esc 拦下，不再冒泡给外层。
// 外框、末尾钮与 Esc 离开另与栏里的单行编辑器共用（表数据顶栏的 WHERE / ORDER BY，见 database/BarCodeInput）。
import { CornerDownLeft, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

/** 前置图标样式（如筛选的 Search）：14px、`--fg-disabled` */
export const BAR_INPUT_ICON = 'size-3.5 shrink-0 text-[color:var(--fg-disabled)]'

/** 外框：高 28px、透明底，聚焦时压 `--bg-row-hover` 底 */
export const BAR_INPUT_FRAME =
  'flex h-7 min-w-0 flex-1 items-center gap-1 rounded px-1.5 transition-colors focus-within:bg-[var(--bg-row-hover)]'

/** 末尾小钮（提交 / 清空）：16px 圆形、装 12px 图标 */
const TRAILING_BTN =
  'flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

/** 末尾钮按下时不抢输入框的焦点 */
const keepInputFocus = (e: React.MouseEvent): void => e.preventDefault()

/** Esc 离开输入框：焦点交给 target（下面的树 / 列表 / 表格）；它这一刻不在（如表格还在加载）就只让输入框失焦。 */
export function leaveBarInput(input: HTMLElement, target: HTMLElement | null): void {
  if (target === null) input.blur()
  else target.focus({ preventScroll: true })
}

/** 末尾钮：给了 onSubmit 时先「提交」（同回车），再「清空」；按下时不抢输入框的焦点。 */
export function BarInputActions({
  onSubmit,
  submitTitle,
  onClear
}: {
  onSubmit?: () => void
  submitTitle: string
  onClear: () => void
}): React.JSX.Element {
  return (
    <>
      {onSubmit !== undefined && (
        <button
          type="button"
          title={submitTitle}
          className={TRAILING_BTN}
          onMouseDown={keepInputFocus}
          onClick={() => onSubmit()}
        >
          <CornerDownLeft className="size-3" />
        </button>
      )}
      <button
        type="button"
        title="清空"
        className={TRAILING_BTN}
        onMouseDown={keepInputFocus}
        onClick={onClear}
      >
        <X className="size-3" />
      </button>
    </>
  )
}

export function BarInput({
  ref,
  value,
  onChange,
  onSubmit,
  submitTitle = '前往',
  onClear,
  escapeFocusRef,
  leading,
  placeholder,
  title,
  disabled = false,
  spellCheck,
  className
}: {
  ref?: React.Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  /** 给了即提交模式：回车（排除输入法合成）或点末尾「提交」钮时调用 */
  onSubmit?: () => void
  /** 提交钮的悬停说明 */
  submitTitle?: string
  /**
   * Esc 或点「清空」时调用，默认 `onChange('')`。给了就替代默认，不再调 onChange：
   * 调用方要自己把值清空，再做连带的事（如 `() => { setDraft(''); apply('') }`）
   */
  onClear?: () => void
  /** Esc 后焦点交给它：下面的树 / 列表（可聚焦的容器）；这一刻不在时输入框只失焦 */
  escapeFocusRef: React.RefObject<HTMLElement | null>
  /** 前置内容：图标（配 BAR_INPUT_ICON） */
  leading?: React.ReactNode
  placeholder?: string
  /** 悬停说明（整个框） */
  title?: string
  /** 停用：输入不可改，末尾钮不出 */
  disabled?: boolean
  spellCheck?: boolean
  /** 外框补充样式 */
  className?: string
}): React.JSX.Element {
  const clear = onClear ?? ((): void => onChange(''))
  return (
    <div title={title} className={cn(BAR_INPUT_FRAME, className)}>
      {leading}
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        spellCheck={spellCheck}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSubmit !== undefined && e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            clear()
            leaveBarInput(e.currentTarget, escapeFocusRef.current)
          }
        }}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[color:var(--fg-disabled)]"
      />
      {value !== '' && !disabled && (
        <BarInputActions onSubmit={onSubmit} submitTitle={submitTitle} onClear={clear} />
      )}
    </div>
  )
}
