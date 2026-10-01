// 切换控制台上下文的下拉（docs/prd/database.md「控制台上下文」）：SQL 控制台工具栏右端的「库」「模式」（combobox，
// PostgreSQL 两个，MySQL / MariaDB 只有「库」；「库」只列显示的库），Redis 键列表顶栏的库编号（菜单，菜单项由调用方给）。
// 钮都是显示当前值的下拉钮（ui/toolbar 的 TOOLBAR_SELECT）：图标 + 服务器上的当前值（真的为空时为灰色的「未选择库」
// 「未选择模式」）+ ChevronDown。两种共用一套切换（lib/data-source-context 的 useContextSwitch，目录右键「在控制台中打开」
// 也用它）：与同一个 Tab 的控制台执行互斥——执行中置灰；切换中要变的钮转圈并置灰（切库时「库」或库编号，切模式时「模式」，
// 目录右键跨库切模式时两个都转；不论从哪里发起），其余与「执行」只置灰；点的就是当前那一项时不切；切不过去弹错误框（按
// 没切过去的那一级：「无法切换库」「无法切换模式」），正文为原因。
import { useState } from 'react'
import { ChevronDown, Database, Layers, type LucideIcon } from 'lucide-react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger
} from '@renderer/components/ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { BusyIcon, TOOLBAR_SELECT } from '@renderer/components/ui/toolbar'
import { useCatalogLayer, useContextSwitch } from '@renderer/lib/data-source-context'
import type { useSpinUntilRest } from '@renderer/lib/use-spin-until-rest'
import { cn } from '@renderer/lib/utils'
import type { CatalogResult } from '@shared/data-source-catalog'
import type { ConsoleContext, ConsoleContextChange } from '@shared/data-source-context'
import { queryFailureText } from '@shared/data-source-query'

/** SQL 数据库的控制台上下文。 */
type SqlContext = Exclude<ConsoleContext, { kind: 'redis' }>

// 钮：显示当前值的下拉钮；置灰与恢复的过渡跟图标的淡入淡出同步
const TRIGGER = cn(TOOLBAR_SELECT, 'duration-200')

/**
 * 控制台工具栏右端（SQLite 没有）：「库」，PostgreSQL 另有「模式」。先换库、再换模式——模式只列控制台所在库的。
 */
export function ConsoleContextComboboxes({
  tabKey,
  context,
  shownDatabases
}: {
  tabKey: string
  context: SqlContext
  /** 显示的库：「库」只列它们（控制台正在没显示的库上时，钮上照常是它） */
  shownDatabases?: readonly string[]
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <CatalogCombobox
        tabKey={tabKey}
        context={context}
        level={DATABASE}
        shown={shownDatabases}
        value={context.database}
        change={(database) => ({ kind: context.kind, database })}
      />
      {context.kind === 'postgresql' && (
        <CatalogCombobox
          tabKey={tabKey}
          context={context}
          level={SCHEMA}
          database={context.database}
          value={context.schema}
          change={(schema) => ({ kind: 'postgresql', database: context.database, schema })}
        />
      )}
    </div>
  )
}

/** 「库」或「模式」各自的图标与文字。 */
interface Level {
  /** 目录里这一层的节点类别 */
  kind: 'database' | 'schema'
  icon: LucideIcon
  /** 真的为空时钮上的灰色占位 */
  placeholder: string
  /** 筛选框的占位 */
  filter: string
  /** 列表为空 */
  none: string
  /** 筛选后没有可选的 */
  noMatch: string
}

const DATABASE: Level = {
  kind: 'database',
  icon: Database,
  placeholder: '未选择库',
  filter: '筛选库…',
  none: '没有库',
  noMatch: '没有匹配的库'
}

const SCHEMA: Level = {
  kind: 'schema',
  icon: Layers,
  placeholder: '未选择模式',
  filter: '筛选模式…',
  none: '没有模式',
  noMatch: '没有匹配的模式'
}

/** 「库」只列显示的库，一个都没显示时列表里的说明 */
const NONE_SHOWN = '没有显示的库'

/**
 * 「库」或「模式」：钮上是服务器上的当前值；列表打开时读（目录的一层，先显示表结构缓存，见 useCatalogLayer），顶部的
 * 筛选框按文字筛选，选中即切。「库」列目录根这一层里显示的库，选中只换库（PostgreSQL 不改 search_path，MySQL / MariaDB
 * 即 USE）；「模式」列控制台所在库的模式，选中即把它放到 search_path 最前。
 */
function CatalogCombobox({
  tabKey,
  context,
  level,
  database,
  shown,
  value,
  change
}: {
  tabKey: string
  context: SqlContext
  level: Level
  /** 列哪个库里的这一层；不给为目录根这一层 */
  database?: string
  /** 只列其中的（「库」为显示的库）；不给为全部 */
  shown?: readonly string[]
  /** 钮上的当前值；为空为 null */
  value: string | null
  /** 选中一项时要切到的 */
  change: (name: string) => ConsoleContextChange
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const names = namesOf(useCatalogLayer(tabKey, open, database), level.kind)
  const { disabled, spin, switchTo, failure, dismiss } = useContextSwitch(
    tabKey,
    context,
    level.kind
  )
  const all = Array.isArray(names) ? names : []
  const items = shown === undefined ? all : all.filter((name) => shown.includes(name))
  const hint = !Array.isArray(names)
    ? names.hint
    : all.length === 0
      ? level.none
      : items.length === 0
        ? NONE_SHOWN
        : level.noMatch

  return (
    <>
      <Combobox
        items={items}
        value={value}
        onValueChange={(name) => {
          if (name !== null) switchTo(change(name))
        }}
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <ComboboxTrigger title={value ?? undefined} className={cn(TRIGGER, 'max-w-48')}>
          <ContextValue
            icon={level.icon}
            spin={spin}
            value={value}
            placeholder={level.placeholder}
          />
        </ComboboxTrigger>
        <ComboboxContent align="end" className="max-w-80">
          <ComboboxInput placeholder={level.filter} />
          <ComboboxEmpty>{hint}</ComboboxEmpty>
          <ComboboxList>
            {(name: string) => (
              <ComboboxItem key={name} value={name} title={name}>
                {name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {failure !== null && (
        <ErrorDialog title={failure.title} message={failure.message} onClose={dismiss} />
      )}
    </>
  )
}

/** 一层目录里库或模式的名字；还在读、读不出来时为列表里的那一行说明。 */
function namesOf(layer: CatalogResult | null, kind: Level['kind']): string[] | { hint: string } {
  if (layer === null) return { hint: '正在加载…' }
  if (!('nodes' in layer)) return { hint: queryFailureText(layer) }
  return layer.nodes.flatMap((node) => (node.kind === kind ? [node.name] : []))
}

/**
 * 菜单式的下拉（Redis 键列表顶栏的库编号）：`Database` + 当前值；菜单项由调用方给（打开时才挂载，各自读要列的项），
 * 点一项即把要切到的交给 switchTo。
 */
export function ConsoleContextDropdown({
  tabKey,
  context,
  value,
  items
}: {
  tabKey: string
  /** 控制台上下文：点的就是它时不切 */
  context: ConsoleContext
  /** 钮上的当前值 */
  value: string
  /** 菜单项：点一项即把要切到的交给 switchTo */
  items: (switchTo: (change: ConsoleContextChange) => void) => React.ReactNode
}): React.JSX.Element {
  const { disabled, spin, switchTo, failure, dismiss } = useContextSwitch(
    tabKey,
    context,
    'database'
  )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger title={value} disabled={disabled} className={cn(TRIGGER, 'shrink-0')}>
          <ContextValue icon={Database} spin={spin} value={value} />
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        {/* 左对齐，最高 320px，超出滚动 */}
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {items(switchTo)}
        </DropdownMenuContent>
      </DropdownMenu>
      {failure !== null && (
        <ErrorDialog title={failure.title} message={failure.message} onClose={dismiss} />
      )}
    </>
  )
}

/** 钮上的图标（切换中换成转圈）与当前值；真的为空时为灰色的占位。 */
function ContextValue({
  icon,
  spin,
  value,
  placeholder
}: {
  icon: LucideIcon
  spin: ReturnType<typeof useSpinUntilRest>
  value: string | null
  placeholder?: string
}): React.JSX.Element {
  return (
    <>
      <BusyIcon icon={icon} {...spin} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          value === null && 'text-[color:var(--fg-disabled)]'
        )}
      >
        {value ?? placeholder}
      </span>
    </>
  )
}
