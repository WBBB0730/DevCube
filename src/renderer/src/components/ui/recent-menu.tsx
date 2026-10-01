// 「最近打开」下拉（Files 工具栏的最近打开文件、数据源内容区顶栏的最近打开对象共用）：FileClock 钮 + 条目列表，每项为
// 名称加淡色的位置。⌘E 由调用方受控打开（不经 onOpenChange）时预选第一个不是当前那一项的条目，回车即回到上一个；
// 点按钮打开的高亮仍由 Base UI 自管。
// 关闭后焦点：选中条目、或 ⌘E 打开的菜单被关掉时不回按钮，交给正文——选中由调用方打开后自行聚焦，Esc 由
// `onFocusContent` 回到正文（不提供时焦点落 body）；点按钮打开后 Esc 仍按常规还给按钮。
import { useLayoutEffect, useRef } from 'react'
import { FileClock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'

export interface RecentMenuItem {
  /** 条目的键（认当前那一项、React key 用） */
  key: string
  name: string
  /** 名称后面淡色的位置（所在目录、库.模式）；没有为空串 */
  location: string
  /** 悬停说明 */
  title: string
}

export function RecentMenu({
  title,
  emptyText,
  items,
  currentKey,
  open,
  onOpenChange,
  onPick,
  onFocusContent
}: {
  /** 按钮的悬停说明 */
  title: string
  /** 没有条目时列表里的一行说明 */
  emptyText: string
  items: RecentMenuItem[]
  /** 当前打开着的那一项的键（⌘E 打开时跳过它预选下一项）；没有为 null */
  currentKey: string | null
  /** 开合（受控：⌘E / Ctrl+E 由调用方打开） */
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (key: string) => void
  /** 焦点回正文（⌘E 打开的下拉被 Esc 关掉时） */
  onFocusContent?: () => void
}): React.JSX.Element {
  // 点按钮打开时 Base UI 先回调 onOpenChange(true)；⌘E 受控打开不经回调
  const triggerOpening = useRef(false)
  // 本次打开的来源与关闭原因，供预选与关闭后焦点去向判断
  const openedBy = useRef<'trigger' | 'shortcut'>('trigger')
  const closeReason = useRef<string | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useLayoutEffect(() => {
    if (!open) return
    openedBy.current = triggerOpening.current ? 'trigger' : 'shortcut'
    triggerOpening.current = false
    closeReason.current = null
  }, [open])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          triggerOpening.current = true
        } else {
          closeReason.current = details.reason
          if (details.reason === 'escape-key' && openedBy.current === 'shortcut') onFocusContent?.()
        }
        onOpenChange(next)
      }}
      onOpenChangeComplete={(next) => {
        if (!next || openedBy.current !== 'shortcut') return
        // 焦点落到条目即高亮（菜单的 roving focus）；第一项通常就是当前那一项
        const i = items.findIndex((item) => item.key !== currentKey)
        itemRefs.current[i === -1 ? 0 : i]?.focus()
      }}
    >
      <DropdownMenuTrigger title={title} className={TOOLBAR_BTN}>
        <FileClock className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-w-2xl"
        finalFocus={() => openedBy.current !== 'shortcut' && closeReason.current !== 'item-press'}
      >
        {items.length === 0 ? (
          <DropdownMenuHint>{emptyText}</DropdownMenuHint>
        ) : (
          items.map((item, i) => (
            <DropdownMenuItem
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              className="min-w-0 gap-1.5"
              onClick={() => onPick(item.key)}
            >
              <span className="shrink-0" title={item.title}>
                {item.name}
              </span>
              {item.location && (
                <span className="min-w-0 truncate text-muted-foreground" title={item.title}>
                  {item.location}
                </span>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
