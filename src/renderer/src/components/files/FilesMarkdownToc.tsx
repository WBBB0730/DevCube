// Files Tab · Markdown 预览的目录（参照飞书文档）：列出各级标题，按嵌套关系缩进；点击跳到该标题，
// 正文滚到哪一节哪一行点亮，并以最小距离滚入目录的视口。灰字、悬停转正文色，当前标题链接蓝，不加行底，顶层标题加粗一档。
// 两种样子（lib/files-markdown 的 markdownTocView）：开着且放得下时在侧边——不占位，放在正文滚动区里吸顶的零高层上，
// 盖在正文左侧的留白里（放不放得下、多宽由 FilesMarkdownPreview 按滚动区宽度定，markdownTocDockWidth）；
// 侧边没显示时悬停工具栏的目录钮浮出抽屉——从目录钮（Popover 的 Trigger，在 FilesTextEditor）下方浮出，外观同其他弹层。
import { useEffect, useRef } from 'react'
import { PopoverContent } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

/** 目录里的一个标题：源码起始行（0 起）、缩进层数、显示文字 */
export type MarkdownTocItem = { line: number; level: number; text: string }

type TocListProps = {
  items: readonly MarkdownTocItem[]
  /** 当前标题的下标；-1 = 视口顶边还在第一个标题之前，不点亮 */
  current: number
  onSelect: (index: number) => void
}

/** 每层缩进 */
const INDENT = 14

/** 标题列表（停靠与抽屉共用） */
function TocList({
  items,
  current,
  onSelect,
  className
}: TocListProps & { className?: string }): React.JSX.Element {
  const listRef = useRef<HTMLElement>(null)

  // 当前行不在目录视口内才滚（nearest），点目录跳转时它本就可见、不动
  useEffect(() => {
    if (current >= 0) listRef.current?.children[current]?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav ref={listRef} aria-label="目录" className={className}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          title={item.text}
          className={cn(
            'flex h-7 w-full cursor-pointer items-center text-left text-[13px] transition-colors',
            item.level === 0 && 'font-medium',
            i === current
              ? 'text-[color:var(--link)]'
              : 'text-[color:var(--fg-muted)] hover:text-foreground'
          )}
          style={{ paddingLeft: item.level * INDENT }}
          onClick={() => onSelect(i)}
        >
          <span className="truncate">{item.text}</span>
        </button>
      ))}
    </nav>
  )
}

/** 停靠的目录：宽度由滚动区上的 --files-md-toc-w 给（main.css「Markdown 预览的版心与目录」） */
export function FilesMarkdownToc(props: TocListProps): React.JSX.Element {
  return (
    <div className="files-md-toc">
      <TocList {...props} className="files-md-toc-list" />
    </div>
  )
}

/**
 * 抽屉里的目录：须渲染在 FilesTextEditor 的 Popover 之内，开合归它；点了标题不收，离开才收。
 * 浮出时不抢焦点；键盘收起时焦点回正文，鼠标收起时留在点下去的地方
 */
export function FilesMarkdownTocDrawer({
  body,
  onHover,
  ...props
}: TocListProps & {
  /** 正文滚动区：键盘收起后焦点回到这里 */
  body: React.RefObject<HTMLElement | null>
  /** 鼠标进出抽屉 */
  onHover: (event: 'enter' | 'leave') => void
}): React.JSX.Element {
  return (
    <PopoverContent
      initialFocus={false}
      finalFocus={(closeType) => (closeType === 'keyboard' ? body.current : false)}
      className="max-h-[var(--available-height)] w-60 scroll-py-3 p-0"
    >
      {/* 留白也算在抽屉里：进出盖满整个抽屉 */}
      <div
        className="py-3 pr-2 pl-5"
        onPointerEnter={() => onHover('enter')}
        onPointerLeave={() => onHover('leave')}
      >
        <TocList {...props} />
      </div>
    </PopoverContent>
  )
}
