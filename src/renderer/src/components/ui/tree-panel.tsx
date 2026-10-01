// 右侧树面板的外壳（Files 文件树、数据源的目录与 Redis 键列表共用）：面板外框（左边线、panel 底、固定宽 TREE_W）、
// 树顶栏（h-10：筛选 / 前往输入 + 钮组）、当前根行（固定在列表之上不随滚动走）与列表的滚动区样式。行与整树状态见 ./tree。
import { Button } from '@renderer/components/ui/button'
import { TREE_DROP_TARGET, TREE_W } from '@renderer/components/ui/tree'
import { cn } from '@renderer/lib/utils'

/** 树列表的滚动区（在根行之下）：可聚焦（焦点在树上打字转进树顶输入），不画焦点框 */
export const TREE_SCROLL = 'min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1 outline-none'

/** 面板外框：左边线 + panel 底，固定宽 TREE_W（不可拖）；其余属性（如拖放监听）原样给外框 */
export function TreePanel({
  className,
  style,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-[var(--separator)] bg-panel',
        className
      )}
      style={{ width: TREE_W, ...style }}
      {...props}
    />
  )
}

/** 树顶栏：h-10、底边线；放一个 BarInput 与其后的钮组（钮组 `gap-0.5`） */
export function TreePanelBar({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] px-1.5',
        className
      )}
      {...props}
    />
  )
}

/**
 * 当前根行：告诉你树的根是什么（文件夹、数据源）。它是全树的根，图标顶格（不占层级缩进位）、名称加粗；
 * 名称之后可放 actions（如数据源目录的「N / M 个库」），给 onDisconnect 即在右端出「断开连接」。行底按状态：落点 >
 * 右键菜单打开中（保持 hover 底）> hover。其余属性（title、onContextMenu、data-*）原样给行。
 */
export function TreeRootRow({
  icon,
  name,
  actions,
  dropTarget = false,
  menuActive = false,
  onDisconnect,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  icon: React.ReactNode
  name: React.ReactNode
  /** 名称之后、「断开连接」之前的控件 */
  actions?: React.ReactNode
  /** 从别处拖进来的落点就是根 */
  dropTarget?: boolean
  /** 根的右键菜单打开中 */
  menuActive?: boolean
  onDisconnect?: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'mx-1.5 mt-1 flex h-8 shrink-0 cursor-default items-center gap-1 rounded px-1.5 text-[13px] text-foreground transition-colors',
        dropTarget
          ? TREE_DROP_TARGET
          : menuActive
            ? 'bg-[var(--bg-row-hover)]'
            : 'hover:bg-[var(--bg-row-hover)]',
        className
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {actions}
      {onDisconnect && (
        <Button variant="destructiveSoft" className="h-6 px-2 text-[12px]" onClick={onDisconnect}>
          断开连接
        </Button>
      )}
    </div>
  )
}
