// Redis 的 Data Source Tab 右侧的键列表（docs/prd/database.md「Redis」）：外壳与行同目录（ui/tree-panel、ui/tree）。
// SCAN 列出键（最多 1 万个），按 `:` 分组成树。顶栏：库编号下拉（各库带键数；列的是 Tab 的控制台上下文所在的库，控制台
// 里 SELECT 之后跟着换库、重新列出；控制台执行中不能切，开着事务时切不过去）、按模式筛选（服务器端 MATCH，回车生效）、
// 刷新（重新列出，列出前旧列表留着、只靠刷新钮转圈，展开着的文件夹保持展开）、全部折叠；之下是根行（数据源名与「断开
// 连接」）。
// 键行右键可复制键名，文件夹行可复制前缀。「在键列表中显示」（调用方经 reveal 要求）：展开到键，行出现即滚入视口；
// 被模式筛选挡住（不在列出的键里）时先清掉模式、重新列出。
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Check, ChevronsDownUp, Database, Folder, KeyRound, Search } from 'lucide-react'
import { BAR_INPUT_ICON, BarInput } from '@renderer/components/ui/bar-input'
import { DropdownMenuHint, DropdownMenuItem } from '@renderer/components/ui/dropdown-menu'
import { RefreshButton, TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import {
  TREE_ICON,
  TREE_ROW_H,
  TreeHint,
  TreeNoticeRow,
  TreeRow
} from '@renderer/components/ui/tree'
import {
  TREE_SCROLL,
  TreePanel,
  TreePanelBar,
  TreeRootRow
} from '@renderer/components/ui/tree-panel'
import { useRedisDatabases } from '@renderer/lib/data-source-context'
import { typeToInput } from '@renderer/lib/type-to-input'
import { useTreeVirtualReveal } from '@renderer/lib/use-tree-virtual-reveal'
import { cn } from '@renderer/lib/utils'
import { redisDatabaseLabel, type ConsoleContext } from '@shared/data-source-context'
import {
  buildRedisKeyTree,
  flattenRedisKeyTree,
  REDIS_KEY_LIMIT,
  redisDatabaseIndexes,
  redisKeyFolders,
  type RedisKeyList,
  type RedisKeyRow
} from '@shared/redis'
import { ConsoleContextDropdown } from './ConsoleContextDropdown'
import { DataSourceTreeMenu, type DataSourceTreeMenuTarget } from './DataSourceTreeMenu'

const FILTER_PLACEHOLDER = '按模式筛选'
const FILTER_HINT = '按模式筛选，如 user:*'

/** 右键菜单认行用的键：文件夹以前缀、键以键名，前面加上类别免得撞上 */
const folderRowKey = (prefix: string): string => `folder\0${prefix}`
const keyRowKey = (key: string): string => `key\0${key}`

/** 键列表的行在「在键列表中显示」里认的键：键行为键名，文件夹不认 */
const revealKeyOf = (row: RedisKeyRow): string | undefined =>
  row.kind === 'key' ? row.node.key : undefined

/** Redis 的控制台上下文：键列表与控制台所在的库。 */
type RedisContext = Extract<ConsoleContext, { kind: 'redis' }>

/** 调用方要的操作：在键列表中显示当前键。 */
export interface RedisKeyTreeHandle {
  reveal: (key: string) => void
}

export function RedisKeyTree({
  ref,
  tabKey,
  context,
  name,
  selectedKey,
  onOpenKey,
  onDisconnect
}: {
  ref?: React.Ref<RedisKeyTreeHandle>
  tabKey: string
  /** 控制台上下文（Data Source Tab 读一份交来，见 useConsoleContext）：尚未得知为 undefined */
  context: ConsoleContext | null | undefined
  /** 根行显示的数据源名 */
  name: string
  selectedKey: string | null
  /** 点了一个键：完整键名 */
  onOpenKey: (key: string) => void
  onDisconnect: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [pattern, setPattern] = useState('')
  const [reload, setReload] = useState(0)
  // 结果连同它回答的请求一起存：请求变了而结果还是旧的即读取中（旧列表照常显示）
  const [list, setList] = useState<{ key: string; outcome: RedisKeyList } | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<DataSourceTreeMenuTarget | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  // 列的是控制台上下文所在的库：换了库（下拉切换、控制台里 SELECT）即重新列出；还没得知时先不列（连上后主进程先切到
  // Tab 记住的库）
  const known = context !== undefined
  const database = context?.kind === 'redis' ? context.database : null
  const listKey = JSON.stringify([pattern, reload, database])

  useEffect(() => {
    if (!known) return
    let current = true
    void window.api.scanRedisKeys(tabKey, pattern).then((outcome) => {
      if (current) setList({ key: listKey, outcome })
    })
    return () => {
      current = false
    }
  }, [tabKey, pattern, listKey, known])

  const loading = list?.key !== listKey
  const outcome = list?.outcome ?? null
  const tree = useMemo(
    () => (outcome !== null && 'keys' in outcome ? buildRedisKeyTree(outcome.keys) : []),
    [outcome]
  )
  const rows = useMemo(() => flattenRedisKeyTree(tree, expanded), [tree, expanded])
  // 列表末尾的一行提示：列不出来，或只列出了一部分
  const notice =
    outcome === null
      ? null
      : 'error' in outcome
        ? outcome.error
        : outcome.truncated
          ? `只列出了前 ${REDIS_KEY_LIMIT} 个键`
          : null
  const { scrollRef, virtualizer, scrollToRow } = useTreeVirtualReveal({
    rows,
    count: rows.length + (notice === null ? 0 : 1),
    rowHeight: TREE_ROW_H,
    rowKey: revealKeyOf
  })

  const applyPattern = (next: string): void => {
    setDraft(next)
    setPattern(next)
  }

  const toggle = (prefix: string): void => {
    const next = new Set(expanded)
    if (!next.delete(prefix)) next.add(prefix)
    setExpanded(next)
  }

  /** 在键列表中显示：展开到键，行出现即滚入视口；被模式筛选挡住则先清掉模式、重新列出 */
  const reveal = (key: string): void => {
    const listed = outcome !== null && 'keys' in outcome && outcome.keys.includes(key)
    if (pattern !== '' && !listed) applyPattern('')
    setExpanded((prev) => new Set([...prev, ...redisKeyFolders(key)]))
    scrollToRow(key)
  }
  useImperativeHandle(ref, () => ({ reveal }))

  const openMenu = (
    e: React.MouseEvent,
    target: Omit<DataSourceTreeMenuTarget, 'x' | 'y'>
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, ...target })
  }

  return (
    <TreePanel>
      <TreePanelBar>
        {context?.kind === 'redis' && <DatabaseMenu tabKey={tabKey} context={context} />}
        <BarInput
          ref={filterInputRef}
          value={draft}
          onChange={setDraft}
          onSubmit={() => applyPattern(draft.trim())}
          onClear={() => applyPattern('')}
          escapeFocusRef={scrollRef}
          submitTitle="筛选"
          spellCheck={false}
          leading={<Search className={BAR_INPUT_ICON} />}
          title={FILTER_HINT}
          placeholder={FILTER_PLACEHOLDER}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <RefreshButton
            refreshing={loading}
            title="刷新"
            onClick={() => setReload((n) => n + 1)}
          />
          <button
            type="button"
            title="全部折叠"
            className={TOOLBAR_BTN}
            onClick={() => setExpanded(new Set())}
          >
            <ChevronsDownUp className="size-4" />
          </button>
        </div>
      </TreePanelBar>
      <TreeRootRow
        title={name}
        icon={<Database className={TREE_ICON} />}
        name={name}
        onDisconnect={onDisconnect}
      />
      <div
        ref={scrollRef}
        tabIndex={0}
        className={TREE_SCROLL}
        // 焦点在树上打字转进树顶的筛选（只改草稿，回车才生效）
        onKeyDown={(e) =>
          typeToInput(e, {
            query: draft,
            inputRef: filterInputRef,
            onChange: setDraft,
            onClear: () => applyPattern('')
          })
        }
      >
        {outcome === null ? (
          <TreeHint loading>正在读取…</TreeHint>
        ) : 'keys' in outcome && outcome.keys.length === 0 ? (
          <TreeHint>没有键</TreeHint>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index]
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {row === undefined ? (
                    // 末尾多出的那一行只在有提示时才有
                    <TreeNoticeRow depth={0} message={notice!} />
                  ) : row.kind === 'folder' ? (
                    <TreeRow
                      depth={row.depth}
                      expanded={expanded.has(row.node.prefix)}
                      icon={<Folder className={TREE_ICON} />}
                      name={row.node.name}
                      extra={row.node.count}
                      title={`${row.node.prefix}* ${row.node.count}`}
                      selected={false}
                      menuActive={menu?.rowKey === folderRowKey(row.node.prefix)}
                      onClick={() => toggle(row.node.prefix)}
                      onContextMenu={(e) =>
                        openMenu(e, {
                          rowKey: folderRowKey(row.node.prefix),
                          copy: { label: '复制前缀', text: row.node.prefix }
                        })
                      }
                    />
                  ) : (
                    <TreeRow
                      depth={row.depth}
                      icon={<KeyRound className={TREE_ICON} />}
                      name={row.node.name}
                      title={row.node.key}
                      selected={selectedKey === row.node.key}
                      menuActive={menu?.rowKey === keyRowKey(row.node.key)}
                      onClick={() => onOpenKey(row.node.key)}
                      onContextMenu={(e) =>
                        openMenu(e, {
                          rowKey: keyRowKey(row.node.key),
                          copy: { label: '复制键名', text: row.node.key }
                        })
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <DataSourceTreeMenu menu={menu} onClose={() => setMenu(null)} />
    </TreePanel>
  )
}

/**
 * 库编号下拉（键列表顶栏最左，外壳见 ConsoleContextDropdown）：钮上是键列表与控制台所在的库（db0、db1……）。打开时读库的
 * 个数（取不到按 16）与各库的键数（有键的库在名字后淡色写出）；点即切过去（键列表随之重新列出），控制台开着事务时切
 * 不过去。
 */
function DatabaseMenu({
  tabKey,
  context
}: {
  tabKey: string
  context: RedisContext
}): React.JSX.Element {
  return (
    <ConsoleContextDropdown
      tabKey={tabKey}
      context={context}
      value={redisDatabaseLabel(context.database)}
      items={(switchTo) => (
        <DatabaseItems
          tabKey={tabKey}
          current={context.database}
          onSwitch={(database) => switchTo({ kind: 'redis', database })}
        />
      )}
    />
  )
}

/** 菜单里的各库（打开时读）：选中标记、db 编号与淡色的键数（没有键的不写）。 */
function DatabaseItems({
  tabKey,
  current,
  onSwitch
}: {
  tabKey: string
  current: number
  onSwitch: (database: number) => void
}): React.JSX.Element {
  const databases = useRedisDatabases(tabKey)
  if (databases === null) return <DropdownMenuHint>正在加载…</DropdownMenuHint>
  if ('error' in databases) return <DropdownMenuHint>{databases.error}</DropdownMenuHint>
  return (
    <>
      {redisDatabaseIndexes(databases, current).map((database) => (
        <DropdownMenuItem key={database} onClick={() => onSwitch(database)}>
          <Check className={cn('size-3.5 shrink-0', database !== current && 'invisible')} />
          <span className="flex-1">{redisDatabaseLabel(database)}</span>
          {databases.keys[database] !== undefined && (
            <span className="pl-4 tabular-nums text-muted-foreground">
              {databases.keys[database]!.toLocaleString()}
            </span>
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}
