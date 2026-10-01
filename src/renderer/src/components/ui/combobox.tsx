// Base UI Combobox 封装（vendored shadcn 风格）：可筛选、只能从列表里选的下拉，按 Base UI「弹层里放输入框」的写法——钮上
// 显示当前值，点开是列表，顶部的筛选框打字即按文字筛选（不能自由输入）并高亮第一个匹配项；↑↓ 挑、回车选，Esc 只收起弹层
// （不往外冒泡）；弹层开着时点外面只收起，不穿透到下面（模态，同 Select）。多选（multiple）时每项前为勾选框，点一项即
// 勾上或取消、弹层不收起（打字筛选过的，筛选框随之清空）。
// 钮的样式由调用方给（如 ui/toolbar 的 TOOLBAR_SELECT），末尾自带 ChevronDown；弹层与选项样式同 Select（ui/select），
// 筛选框同 Input。值、列表项（items，交给它筛选）、开合与禁用都经 Root 给。
import { createContext, useContext } from 'react'
import { Combobox as BaseCombobox } from '@base-ui-components/react/combobox'
import { Check, ChevronDown } from 'lucide-react'
import { CHECKBOX_BOX } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'

/** 是不是多选：选项据此画勾选框还是选中的勾（见 ComboboxItem） */
const MultipleContext = createContext(false)

/**
 * 根：模态（点外面只收起、不穿透，遮罩见 ComboboxContent）；打字筛选时自动高亮第一个匹配项，回车即选中（多选时为勾上或
 * 取消）。其余透传。
 */
function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: Omit<BaseCombobox.Root.Props<Value, Multiple>, 'modal' | 'autoHighlight'>
): React.JSX.Element {
  return (
    <MultipleContext.Provider value={props.multiple === true}>
      <BaseCombobox.Root {...props} modal autoHighlight />
    </MultipleContext.Provider>
  )
}

function ComboboxTrigger({
  className,
  title,
  children
}: {
  className?: string
  title?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseCombobox.Trigger className={className} title={title}>
      {children}
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </BaseCombobox.Trigger>
  )
}

/**
 * Portal 仍走 React 树冒泡：弹层与遮罩上的右键拦下，免得落到外面的行（如目录根行）又开一层右键菜单（同
 * ui/dropdown-menu、ui/context-menu）。
 */
const stopContextMenu = (e: React.MouseEvent): void => {
  e.preventDefault()
  e.stopPropagation()
}

/** 弹层：上为筛选框、下为列表（超出滚动）；最高 320px，宽随内容、不窄于钮。 */
function ComboboxContent({
  className,
  align = 'start',
  children
}: {
  className?: string
  align?: 'start' | 'center' | 'end'
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <BaseCombobox.Portal>
      {/* 官方 Backdrop：盖过左树 sticky（z≤40）与表格吸顶的表头（模态自带的遮罩没有层级，盖不住） */}
      <BaseCombobox.Backdrop className="fixed inset-0 z-50" onContextMenu={stopContextMenu} />
      <BaseCombobox.Positioner className="z-50" side="bottom" align={align} sideOffset={4}>
        <BaseCombobox.Popup
          className={cn(
            'flex max-h-80 min-w-[var(--anchor-width)] flex-col overflow-hidden rounded-lg border border-[color:var(--border-input)] bg-elevated shadow-xl outline-none',
            className
          )}
          onContextMenu={stopContextMenu}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  )
}

/** 弹层顶部的筛选框：打开即聚焦，打字即按文字筛选列表；收起后清空。 */
function ComboboxInput({ placeholder }: { placeholder?: string }): React.JSX.Element {
  return (
    <div className="shrink-0 border-b border-[color:var(--separator)] p-1.5">
      <BaseCombobox.Input render={<Input className="h-7" />} placeholder={placeholder} />
    </div>
  )
}

/** 筛选后没有可选的项时的一行说明（不可选）；有项时不占位置。 */
function ComboboxEmpty({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <BaseCombobox.Empty className="px-3 py-3 text-[13px] text-muted-foreground empty:p-0">
      {children}
    </BaseCombobox.Empty>
  )
}

/** 列表：children 按筛选后的每一项渲染；没有项时不占位置。 */
function ComboboxList<Item>({
  children
}: {
  children: (item: Item) => React.ReactNode
}): React.JSX.Element {
  return (
    <BaseCombobox.List className="min-h-0 overflow-y-auto p-1.5 data-[empty]:p-0">
      {children}
    </BaseCombobox.List>
  )
}

function ComboboxItem({
  className,
  value,
  title,
  children
}: {
  className?: string
  value: unknown
  /** 悬停看全（名字过长截断时） */
  title?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const multiple = useContext(MultipleContext)
  return (
    <BaseCombobox.Item
      value={value}
      title={title}
      className={cn(
        'group flex cursor-pointer select-none items-center gap-1.5 rounded px-1.5 py-1.5 text-[13px] text-foreground outline-none data-[highlighted]:bg-[var(--bg-row-hover)]',
        className
      )}
    >
      {multiple ? (
        // 多选：勾选框（同 ui/checkbox），勾上时 primary 底 + 白色 √
        <span
          className={cn(
            CHECKBOX_BOX,
            'group-data-[selected]:border-[color:var(--primary)] group-data-[selected]:bg-primary'
          )}
        >
          <BaseCombobox.ItemIndicator className="flex text-primary-foreground">
            <Check className="size-3" strokeWidth={3} />
          </BaseCombobox.ItemIndicator>
        </span>
      ) : (
        // 选中指示：未选中时保留 16px 占位列，选项文字纵向对齐
        <span className="flex size-4 shrink-0 items-center justify-center">
          <BaseCombobox.ItemIndicator className="flex">
            <Check className="size-3.5" />
          </BaseCombobox.ItemIndicator>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </BaseCombobox.Item>
  )
}

export {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxInput,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem
}
