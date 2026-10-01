// 工具栏图标钮（Files / Git / 数据源等各处顶栏、树顶栏共用）：钮样式（28px 与 24px 小钮、显示当前值的下拉钮）、钮组内竖线
// 分隔、进行中图标与「刷新」钮。
// 钮组一律 `gap-0.5`；禁用态统一置灰到 50% 且不响应指针（写在钮样式里，给 `disabled` 即生效）。
import { LoaderCircle, RotateCw, type LucideIcon } from 'lucide-react'
import { useSpinUntilRest } from '@renderer/lib/use-spin-until-rest'
import { cn } from '@renderer/lib/utils'

/** 图标钮：size-7 圆角 hover 加亮（各处顶栏、Console Tab 栏末尾的「+」），装 size-4 图标 */
export const TOOLBAR_BTN =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

/** 小图标钮：24px、`rounded`（查找栏的上 / 下一个与关闭、分页器的常用值菜单钮等窄处用）；禁用态同 TOOLBAR_BTN */
export const TOOLBAR_BTN_SM =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

/**
 * 显示当前值的下拉钮（SQL 控制台的「库」「模式」、键列表的库编号、Git 顶栏的分支筛选共用）：同工具栏图标钮高 28px、
 * `--border-input` 描边、`--bg-elevated` 底、正文色 13px，hover 压 `--bg-row-hover`；宽随内容，最小与最大宽由调用方给。
 * 内放可选的图标、文字（配 `min-w-0 truncate`）与末尾 muted 的 ChevronDown（size-3.5）。禁用态同 TOOLBAR_BTN
 */
export const TOOLBAR_SELECT =
  'flex h-7 min-w-0 items-center gap-1 rounded border border-[color:var(--border-input)] bg-[var(--bg-elevated)] px-2 text-[13px] text-foreground outline-none transition hover:bg-[var(--bg-row-hover)] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

/** 钮组内分隔：1×12px `--border-input` 竖线（配 `role="separator"`） */
export const TOOLBAR_SEPARATOR = 'mx-0.5 h-3 w-px shrink-0 bg-[var(--border-input)]'

const ICON_LAYER = 'absolute size-4 transition-opacity duration-200'

/** 进行中的钮（配 BusyIcon）：置灰与恢复也走过渡，跟图标的淡入淡出同步 */
export const BUSY_TRANSITION = 'transition-[color,background-color,opacity] duration-200'

/**
 * 进行中图标（「刷新」「导出」等钮共用）：平时是钮自己的图标，进行中换成转圈；两者叠在同一处以淡入淡出切换，不硬换。
 * 转圈结束时先转回原位（useSpinUntilRest）再淡出——刷新箭头与转圈在原位的形状几乎重合，看起来是转圈停下化成箭头。
 * spinning 与 onAnimationIteration 即 useSpinUntilRest 的返回值，展开传入。
 */
export function BusyIcon({
  icon: Icon,
  iconClassName,
  spinning,
  onAnimationIteration
}: {
  /** 平时显示的图标 */
  icon: LucideIcon
  /** 平时那个图标的补充样式（如「执行」钮的绿色）；转圈照钮的文字色 */
  iconClassName?: string
  /** useSpinUntilRest 的 spinning：从开始到转回原位的整段 */
  spinning: boolean
  onAnimationIteration: () => void
}): React.JSX.Element {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <Icon className={cn(ICON_LAYER, iconClassName, spinning ? 'opacity-0' : 'opacity-100')} />
      <LoaderCircle
        className={cn(ICON_LAYER, spinning ? 'animate-spin opacity-100' : 'opacity-0')}
        onAnimationIteration={onAnimationIteration}
      />
    </span>
  )
}

/**
 * 「刷新」图标钮：进行中图标换成转圈、钮置灰不可点；结束后转圈转回原位才换回刷新箭头、恢复可点
 * （见 useSpinUntilRest），转回途中又开始刷新就接着转。自动触发的刷新也算进行中，由调用方并进 refreshing。
 */
export function RefreshButton({
  refreshing,
  title,
  disabled = false,
  onClick
}: {
  /** 刷新进行中 */
  refreshing: boolean
  title: string
  /** 另有原因不可点（如连接已断开）；进行中的置灰不必再并进来 */
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  const spin = useSpinUntilRest(refreshing)
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || spin.spinning}
      className={cn(TOOLBAR_BTN, BUSY_TRANSITION)}
      onClick={onClick}
    >
      <BusyIcon icon={RotateCw} {...spin} />
    </button>
  )
}
