// 右侧树面板（Files 文件树等）共用的尺寸、行与整树状态。行交互对齐左树（选中色 / hover / transition），
// 尺寸更紧凑（行高 32、13px，非左树的 40px / 14px）；行背景全宽，仅内容按层级缩进（每层 12px）。
import { ChevronRight, LoaderCircle } from 'lucide-react'
import { LOADING_HINT_DELAY_MS } from '@renderer/components/ui/centered-hint'
import { useShowAfter } from '@renderer/lib/use-show-after'
import { cn } from '@renderer/lib/utils'

/** 树行固定高（h-8）；虚拟滚动按此定位，改行高须同步 TREE_ROW */
export const TREE_ROW_H = 32
/** 树行底样（不含状态底色，状态见 TreeRow） */
const TREE_ROW =
  'flex h-8 w-full cursor-pointer items-center gap-1 rounded px-1.5 text-left text-[13px] text-foreground transition-colors'
/** 行内图标（文件夹 / 对象类型等）：14px、`--fg-icon` */
export const TREE_ICON = 'size-3.5 shrink-0 text-[color:var(--fg-icon)]'
/** 从别处拖进来时的落点行：行底 + 主色描边 */
export const TREE_DROP_TARGET =
  'bg-[var(--bg-row-hover)] ring-1 ring-inset ring-[color:var(--primary)]'

/** 层级缩进：行背景全宽，仅左侧占位 */
function TreeIndent({ depth }: { depth: number }): React.JSX.Element | null {
  return depth > 0 ? <span className="shrink-0" style={{ width: depth * 12 }} /> : null
}

/**
 * 树行：缩进 + 展开箭头槽（叶子留空占位）+ 图标 + 名称（+ 名称后的补充文字）。
 * 行底按状态：落点 > 选中（`--selection-row`，名称转 `--fg-primary`）> 右键菜单打开中（保持 hover 底）> hover。
 */
export function TreeRow({
  depth,
  expanded,
  icon,
  name,
  nameColor,
  extra,
  title,
  selected,
  menuActive = false,
  dropTarget = false,
  onClick,
  onContextMenu
}: {
  depth: number
  /** 可展开节点的开合；不给即叶子（箭头槽留空） */
  expanded?: boolean
  icon: React.ReactNode
  name: React.ReactNode
  /** 未选中时的名称色（如 Git 状态色）；不给即正文色 */
  nameColor?: string
  /** 名称后的 12px muted 补充文字（如分组的对象数、键数） */
  extra?: React.ReactNode
  title?: string
  selected: boolean
  /** 右键菜单打开中：保持 hover 行底（指针已移入菜单会丢 :hover） */
  menuActive?: boolean
  /** 从别处拖进来的落点就是它 */
  dropTarget?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        TREE_ROW,
        dropTarget
          ? TREE_DROP_TARGET
          : selected
            ? 'bg-[var(--selection-row)]'
            : menuActive
              ? 'bg-[var(--bg-row-hover)]'
              : 'hover:bg-[var(--bg-row-hover)]'
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <TreeIndent depth={depth} />
      {expanded === undefined ? (
        <span className="size-3.5 shrink-0" />
      ) : (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </span>
      )}
      {icon}
      <span
        className={cn('min-w-0 truncate transition-colors', extra === undefined && 'flex-1')}
        style={{ color: selected ? 'var(--fg-primary)' : nameColor }}
      >
        {name}
      </span>
      {extra !== undefined && (
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{extra}</span>
      )}
    </button>
  )
}

/**
 * 树里的一行提示（如读不出来的已展开目录「没有权限」）：在子级位置，12px muted，不可点；过长截断，悬停看全文。
 * loading 为层内「正在读取…」：进入读取中后过 LOADING_HINT_DELAY_MS 才出现（同整树的 TreeHint loading），读得快时不闪。
 */
export function TreeNoticeRow({
  depth,
  message,
  loading = false
}: {
  depth: number
  message: string
  /** 读取中：稍等才出现 */
  loading?: boolean
}): React.JSX.Element {
  // 读取中另起一个组件：每次进入读取中都重新挂载、重新计时
  if (loading) return <TreeLoadingNoticeRow depth={depth} message={message} />
  return (
    <div className={cn(TREE_ROW, 'cursor-default text-muted-foreground')}>
      <TreeIndent depth={depth} />
      <span className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[12px]" title={message}>
        {message}
      </span>
    </div>
  )
}

function TreeLoadingNoticeRow({
  depth,
  message
}: {
  depth: number
  message: string
}): React.JSX.Element | null {
  const shown = useShowAfter(LOADING_HINT_DELAY_MS)
  if (!shown) return null
  return <TreeNoticeRow depth={depth} message={message} />
}

const TREE_HINT =
  'flex h-full min-h-full items-center justify-center gap-1.5 px-1.5 text-[13px] text-muted-foreground'

/**
 * 整树状态：树区居中一行 muted 13px（如「无匹配文件」）。loading 时前置转圈，
 * 进入读取中后过 LOADING_HINT_DELAY_MS 才出现，读得快时不闪。
 */
export function TreeHint({
  loading = false,
  children
}: {
  loading?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  // 读取中另起一个组件：每次进入读取中都重新挂载、重新计时
  return loading ? (
    <TreeLoadingHint>{children}</TreeLoadingHint>
  ) : (
    <div className={TREE_HINT}>{children}</div>
  )
}

function TreeLoadingHint({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const shown = useShowAfter(LOADING_HINT_DELAY_MS)
  if (!shown) return null
  return (
    <div className={TREE_HINT}>
      <LoaderCircle className="size-3.5 animate-spin" />
      {children}
    </div>
  )
}
