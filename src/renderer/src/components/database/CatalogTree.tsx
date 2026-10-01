// Data Source Tab 右侧的目录（docs/prd/database.md「目录」）：外壳与行同 Files 的文件树（ui/tree-panel、ui/tree）。
// 连上即读根这一层；展开一层读一层，每次展开都重新读。读到前先显示表结构缓存（收起前读到的，或主进程里存着的），读到了
// 原地替换；都没有时显示「正在读取…」（稍等才出现，缓存回来得快时不闪）。PostgreSQL、MySQL / MariaDB 的根下只列显示的库
// （调用方按数据源记着交来）：根行右端「N / M 个库」点开是可筛选的勾选列表，勾上 / 取消即交给调用方；一个都没显示时根下
// 先提示「勾选要显示的库」；没显示的库里展开着的层收起，不读。顶栏：按名称筛选（在显示的库里已读取的层与表结构缓存里找，
// 不另查；保留层级结构，开合只作用于筛选视图，清空即回到筛选前的展开）、刷新（重读根与展开着的各层，各层读到即原地替换，
// 进行中旧树留着、只靠刷新钮转圈）、全部折叠；之下是根行（数据源名、显示的库与「断开连接」）。
// 右键菜单：各行（含根行）「在控制台中打开」——切到「控制台」一格（焦点进编辑器，由调用方做），并把控制台所在的库、模式
// 换成这一行所在的（见 catalogConsoleContextChange；不在某个库里、SQLite 只切格），切换同控制台工具栏的「库」「模式」
// （useContextSwitch：控制台正在执行或切换时置灰，切不过去弹错误框）；控制台上下文还不知道时，要换库、模式的行置灰。
// 对象行另可复制名称。
// 「在目录中显示」（调用方经 reveal 要求）：展开到对象（没读过的层照常先显示缓存再现查），行出现即滚入视口；被筛选
// 挡住时先清掉筛选；所在的库没显示时按调用方的要求先勾上它，或不显示。展开着的节点由调用方记下（登记的数据源跨重启
// 保留），挂载（连上）时按记住的展开读各层。
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ChevronsDownUp,
  Database,
  Eye,
  Folder,
  Layers,
  ListOrdered,
  ListTree,
  Puzzle,
  Search,
  SquareFunction,
  Table2,
  Type,
  User,
  Zap
} from 'lucide-react'
import { BAR_INPUT_ICON, BarInput } from '@renderer/components/ui/bar-input'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger
} from '@renderer/components/ui/combobox'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
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
import {
  collapseFilterView,
  filterCatalog,
  filterViewExpanded,
  type FilterOverrides
} from '@renderer/lib/data-source-catalog-filter'
import { useConsoleBusy, useContextSwitch } from '@renderer/lib/data-source-context'
import { createKeyedSubscription } from '@renderer/lib/keyed-subscription'
import { typeToInput } from '@renderer/lib/type-to-input'
import { useTreeVirtualReveal } from '@renderer/lib/use-tree-virtual-reveal'
import {
  CATALOG_GROUP_LABELS,
  catalogDatabases,
  catalogLayerKey,
  catalogListedDatabases,
  catalogNodeKey,
  catalogObjectKey,
  catalogPathShown,
  catalogRevealLayers,
  catalogShownRoot,
  childPath,
  flattenCatalog,
  type CatalogGroup,
  type CatalogNode,
  type CatalogObject,
  type CatalogPath,
  type CatalogResult,
  type CatalogRow
} from '@shared/data-source-catalog'
import { catalogConsoleContextChange, type ConsoleContext } from '@shared/data-source-context'
import { DataSourceTreeMenu, type DataSourceTreeMenuTarget } from './DataSourceTreeMenu'

const FILTER_HINT = '按名称筛选'

/** 表结构缓存还没取到时：筛选先只在已读取的层里找 */
const NO_CACHED_LAYERS: ReadonlyMap<string, CatalogResult> = new Map()

/** 筛选视图还没开合过：全部按默认展开 */
const NO_FILTER_OVERRIDES: FilterOverrides = new Map()

// 各个 Data Source Tab 共用一个底层推送监听，按 Tab 键分发
const subscribeCatalogLayers = createKeyedSubscription(
  window.api.onDataSourceCatalogLayersChanged,
  (event) => event.tabKey
)

const GROUP_OBJECT_ICONS: Record<CatalogGroup, React.JSX.Element> = {
  tables: <Table2 className={TREE_ICON} />,
  views: <Eye className={TREE_ICON} />,
  matviews: <Eye className={TREE_ICON} />,
  functions: <SquareFunction className={TREE_ICON} />,
  procedures: <SquareFunction className={TREE_ICON} />,
  sequences: <ListOrdered className={TREE_ICON} />,
  types: <Type className={TREE_ICON} />,
  triggers: <Zap className={TREE_ICON} />,
  indexes: <ListTree className={TREE_ICON} />,
  events: <CalendarClock className={TREE_ICON} />,
  extensions: <Puzzle className={TREE_ICON} />,
  roles: <User className={TREE_ICON} />,
  users: <User className={TREE_ICON} />
}

/**
 * 调用方要的操作：执行了改结构的语句后重读；在目录中显示当前对象（所在的库没显示时，showDatabase 为真即先勾上它，否则
 * 不显示）。
 */
export interface CatalogTreeHandle {
  refresh: () => void
  reveal: (object: CatalogObject, showDatabase: boolean) => void
}

/** 显示的库（PostgreSQL、MySQL / MariaDB；调用方按数据源记）：根下只列它们，根行勾选即交给 onChange。 */
export interface ShownDatabases {
  databases: readonly string[]
  onChange: (databases: string[]) => void
}

/** 一个库都没显示时根下的提示行（根下的分组照列） */
const NONE_SHOWN_ROW: CatalogRow = {
  kind: 'notice',
  key: '\0none-shown',
  depth: 0,
  message: '勾选要显示的库'
}

/** 根行的「N / M 个库」钮：同「断开连接」高 24px、12px 字；muted，hover 压钮的 hover 底、字转正文色 */
const SHOWN_TRIGGER =
  'flex h-6 shrink-0 items-center gap-0.5 rounded px-1.5 text-[12px] text-muted-foreground outline-none transition-colors hover:bg-[var(--bg-button-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** 只留显示的库里的展开（见 catalogPathShown）；都留着时原样交回。 */
function onlyShown(
  expanded: ReadonlyMap<string, CatalogPath>,
  shown: readonly string[] | undefined
): ReadonlyMap<string, CatalogPath> {
  const kept = [...expanded].filter(([, path]) => catalogPathShown(path, shown))
  return kept.length === expanded.size ? expanded : new Map(kept)
}

/** 目录的行在「在目录中显示」里认的键：节点键 */
const catalogRowKey = (row: CatalogRow): string => row.key

/** 根行在右键菜单里认的键：同根这一层的层键（空串，不与节点键相撞） */
const ROOT_ROW_KEY = ''

/** 右键菜单的目标，另记这一行在目录里的位置（库行、模式行为进入它之后的，见 childPath）：「在控制台中打开」按它换 */
type CatalogMenuTarget = DataSourceTreeMenuTarget & { path: CatalogPath }

function nodeIcon(path: CatalogPath, node: CatalogNode): React.JSX.Element {
  switch (node.kind) {
    case 'database':
      return <Database className={TREE_ICON} />
    case 'schema':
      return <Layers className={TREE_ICON} />
    case 'group':
      return <Folder className={TREE_ICON} />
    case 'object':
      return GROUP_OBJECT_ICONS[path.group!]
  }
}

export function CatalogTree({
  ref,
  tabKey,
  context,
  name,
  shown,
  selectedKey,
  initialExpanded,
  onExpandedChange,
  onOpenObject,
  onOpenConsole,
  onRefresh,
  onDisconnect
}: {
  ref?: React.Ref<CatalogTreeHandle>
  tabKey: string
  /** 控制台上下文（Data Source Tab 读一份交来，见 useConsoleContext）：尚未得知为 undefined，没有（SQLite）为 null */
  context: ConsoleContext | null | undefined
  /** 根行显示的名字：数据源名，Files 面板里直接打开的 SQLite 文件为文件名 */
  name: string
  /** 显示的库；SQLite 没有（根下照原样列） */
  shown?: ShownDatabases
  /** 当前对象在目录里的键（高亮用） */
  selectedKey: string | null
  /** 记住的展开着的节点（节点键与它下一层的位置）：挂载时按它展开、读各层 */
  initialExpanded?: readonly [string, CatalogPath][]
  /** 展开着的节点变了（调用方记下；挂载时恢复出来的那一份不算）；应保持不变的引用 */
  onExpandedChange?: (expanded: [string, CatalogPath][]) => void
  onOpenObject: (object: CatalogObject) => void
  /** 「在控制台中打开」：切到「控制台」一格，焦点进编辑器（控制台所在的库、模式由这里换） */
  onOpenConsole: () => void
  /** 目录重读了（手动刷新或调用方要求）：补全也跟着重读 */
  onRefresh: () => void
  /** 不传则根行没有「断开连接」（Files 面板里直接打开的 SQLite 文件） */
  onDisconnect?: () => void
}): React.JSX.Element {
  const [root, setRoot] = useState<CatalogResult | undefined>()
  // 读过的各层（按节点键）：收起后也留着，筛选连同表结构缓存里的各层一起找
  const [loaded, setLoaded] = useState<ReadonlyMap<string, CatalogResult>>(new Map())
  const shownDatabases = shown?.databases
  // 挂载时恢复的展开（没显示的库里的不算）：按它读各层；展开状态还是这一份时不写回
  const [restored] = useState(
    () => new Map(initialExpanded?.filter(([, path]) => catalogPathShown(path, shownDatabases)))
  )
  // 展开着的节点 → 它下一层的位置（刷新时按它重读）
  const [expanded, setExpanded] = useState<ReadonlyMap<string, CatalogPath>>(restored)
  // 显示的库变了：没显示的库里展开着的层收起（不读没显示的库，再勾上时从收起开始；渲染时就地调整，同 useSpinUntilRest）
  const [seenShown, setSeenShown] = useState(shownDatabases)
  if (shownDatabases !== seenShown) {
    setSeenShown(shownDatabases)
    setExpanded((prev) => onlyShown(prev, shownDatabases))
  }
  /** 进行中的刷新数（调用方要求的刷新可能与手动的叠在一起） */
  const [refreshing, setRefreshing] = useState(0)
  const [filter, setFilter] = useState('')
  /**
   * 筛选时另找的表结构缓存里的各层（按节点键，同 loaded），与一次读完主体结构还在不在进行：还没取到为 null，这时先只在
   * 已读取的层里找；清空筛选即丢掉
   */
  const [cached, setCached] = useState<{
    layers: ReadonlyMap<string, CatalogResult>
    reading: boolean
  } | null>(null)
  /** 筛选时的开合（同 Files：只作用于筛选视图）：只记显式操作，其余默认展开；筛选词一变即清空 */
  const [filterOverrides, setFilterOverrides] = useState<FilterOverrides>(NO_FILTER_OVERRIDES)
  const [menu, setMenu] = useState<CatalogMenuTarget | null>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)
  const consoleSwitch = useContextSwitch(tabKey, context)
  const consoleBusy = useConsoleBusy(tabKey)

  const readLayer = useCallback(
    (path: CatalogPath): Promise<CatalogResult> => window.api.readDataSourceCatalog(tabKey, path),
    [tabKey]
  )
  const peekLayer = useCallback(
    (path: CatalogPath): Promise<CatalogResult | null> =>
      window.api.peekDataSourceCatalog(tabKey, path),
    [tabKey]
  )

  /** 现读一层，读到了原地替换；peek 时先取缓存显示（现查已经到了，晚到的缓存就不用了）。 */
  const loadLayer = useCallback(
    (key: string, path: CatalogPath, peek: boolean): void => {
      if (peek) {
        void peekLayer(path).then((cached) => {
          if (cached === null) return
          setLoaded((prev) => (prev.has(key) ? prev : new Map(prev).set(key, cached)))
        })
      }
      void readLayer(path).then((result) => {
        setLoaded((prev) => new Map(prev).set(key, result))
      })
    },
    [peekLayer, readLayer]
  )

  // 连上（本组件随连接挂载）即读根这一层与记住的展开着的各层：有缓存先显示；现查已经到了，晚到的缓存就不用了
  useEffect(() => {
    void peekLayer({}).then((cached) => {
      if (cached !== null) setRoot((prev) => prev ?? cached)
    })
    void readLayer({}).then(setRoot)
    for (const [key, path] of restored) loadLayer(key, path, true)
  }, [peekLayer, readLayer, loadLayer, restored])

  // 展开着的节点变了即交给调用方记下（恢复出来的那一份不写回）
  useEffect(() => {
    if (expanded !== restored) onExpandedChange?.([...expanded])
  }, [expanded, restored, onExpandedChange])

  /** 各次进行中的刷新要在根换上时丢掉的旧层（刷新前读过、这次不重读的），见 refresh */
  const staleOnRefresh = useRef(new Set<Map<string, CatalogResult>>())

  /**
   * 展开一层：每次都重新读，读到了原地替换。读到前先显示收起前读到的（读成功的才算），没有时取缓存；缓存也没有时显示
   * 「正在读取…」
   */
  const expand = (key: string, path: CatalogPath): void => {
    // 刷新进行中又展开了它：根换上时不再当作收起的旧层丢掉，读到前照常显示旧的
    for (const stale of staleOnRefresh.current) stale.delete(key)
    const showing = loaded.get(key)
    const stale = showing === undefined || !('nodes' in showing)
    if (stale) {
      setLoaded((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    }
    setExpanded((prev) => new Map(prev).set(key, path))
    loadLayer(key, path, stale)
  }

  // 根下只列显示的库（SQLite 没有显示的库，照原样）
  const shownRoot = useMemo(
    () =>
      root === undefined || shownDatabases === undefined
        ? root
        : catalogShownRoot(root, shownDatabases),
    [root, shownDatabases]
  )
  // 根行的「N / M 个库」：根这一层列出的库与其中显示的（勾着的）；根还没读到、读不出来时没有，SQLite 没有
  const databases = useMemo(
    () =>
      root === undefined || !('nodes' in root) || shownDatabases === undefined
        ? null
        : {
            all: catalogDatabases(root.nodes),
            listed: catalogListedDatabases(shownDatabases, root.nodes)
          },
    [root, shownDatabases]
  )

  const query = filter.trim()
  const filtering = query !== ''

  /** 改筛选词（同 Files 的 updateFilterQuery）：词一变，筛选视图的开合回到全部展开；清空即丢掉取来的缓存 */
  const updateFilter = (value: string): void => {
    setFilter(value)
    const next = value.trim()
    if (next !== query) setFilterOverrides(NO_FILTER_OVERRIDES)
    if (next === '') setCached(null)
  }

  // 筛选时取表结构缓存里的各层（不访问数据库）：进入筛选、根这一层重读后（连上、刷新）、一次读完主体结构写进一批与
  // 读取结束时（推送）取，以最新的一次为准；改筛选词不重取
  useEffect(() => {
    if (!filtering) return
    let active = true
    let latest = 0
    const peek = (): void => {
      const seq = ++latest
      void window.api.peekDataSourceCatalogLayers(tabKey).then(({ layers, reading }) => {
        if (active && seq === latest)
          setCached({ layers: new Map(Object.entries(layers)), reading })
      })
    }
    peek()
    const unsubscribe = subscribeCatalogLayers(tabKey, peek)
    return () => {
      active = false
      unsubscribe()
    }
  }, [tabKey, filtering, root])
  const filtered = useMemo(
    () =>
      filtering && shownRoot !== undefined
        ? filterCatalog(shownRoot, loaded, cached?.layers ?? NO_CACHED_LAYERS, query)
        : null,
    [filtering, query, shownRoot, loaded, cached]
  )
  // 没有匹配。缓存还没取到（只在已读取的层里找过）、或后台还在一次读完主体结构（之后还有层写进缓存）时不算定论，不显示
  // 「无匹配对象」，改为「正在读取…」（同 Files 冷索引扫描完成前不显示「无匹配文件」）
  const filterEmpty = filtered !== null && filtered.root.nodes.length === 0
  const filterPending = filterEmpty && (cached === null || cached.reading)
  const filterOpen = useMemo(
    () => (filtered === null ? null : filterViewExpanded(filtered, filterOverrides)),
    [filtered, filterOverrides]
  )
  const displayExpanded = filterOpen ?? expanded

  const refresh = async (): Promise<void> => {
    // 重读展开着的各层；筛选时另加筛选视图里展开着的、读过的层（缓存里取来的不重读，批量读取写进缓存后随推送重取）
    const targets = [...expanded]
    if (filtered !== null && filterOpen !== null) {
      for (const [key, path] of filtered.paths) {
        if (filterOpen.has(key) && loaded.has(key) && !expanded.has(key)) targets.push([key, path])
      }
    }
    const reloaded = new Set(targets.map(([key]) => key))
    const stale = new Map([...loaded].filter(([key]) => !reloaded.has(key)))
    staleOnRefresh.current.add(stale)
    setRefreshing((n) => n + 1)
    try {
      // SQLite 先重新打开文件（被整个替换后也能读到新内容；开着事务时不重开，免得悄悄回滚），其余类型直接重读
      await window.api.reopenDataSourceSession(tabKey)
      onRefresh()
      // 根与各层读到即原地替换：一次读完主体结构里的层等它所在的那一批，第一批的层与根不被第二批的挡住。根换上时即丢掉
      // 刷新前读过、这次不重读的层（收起着的，不显示；再展开时现读），筛选改在缓存里找，不挡着批量读取写进来的新内容；
      // 刷新期间另读到的（结果已换过）与又展开的（见 expand）留着
      await Promise.all([
        readLayer({}).then((result) => {
          setRoot(result)
          setLoaded((prev) => {
            const next = new Map(prev)
            for (const [key, layer] of stale) {
              if (next.get(key) === layer) next.delete(key)
            }
            return next
          })
        }),
        ...targets.map(([key, path]) =>
          readLayer(path).then((result) => setLoaded((prev) => new Map(prev).set(key, result)))
        )
      ])
    } finally {
      staleOnRefresh.current.delete(stale)
      setRefreshing((n) => n - 1)
    }
  }

  const rows = useMemo(() => {
    if (filtered !== null) return flattenCatalog(filtered.root, filtered.loaded, filterOpen!)
    const rows = flattenCatalog(shownRoot, loaded, expanded)
    // 一个库都没显示：根下先提示去勾选
    const noneShown =
      databases !== null && databases.all.length > 0 && databases.listed.length === 0
    return noneShown ? [NONE_SHOWN_ROW, ...rows] : rows
  }, [filtered, filterOpen, shownRoot, loaded, expanded, databases])
  const { scrollRef, virtualizer, scrollToRow } = useTreeVirtualReveal({
    rows,
    rowHeight: TREE_ROW_H,
    rowKey: catalogRowKey,
    getItemKey: (i) => rows[i]!.key
  })

  const toggle = (key: string, path: CatalogPath): void => {
    if (filtered !== null && filterOpen !== null) {
      // 筛选时开合只作用于筛选视图，清空筛选即回到筛选前的展开；点开没拿到的层照常现读（先显示缓存），不是为筛选另查
      const open = !filterOpen.has(key)
      setFilterOverrides(new Map(filterOverrides).set(key, open))
      if (open && !filtered.loaded.has(key)) loadLayer(key, path, true)
      return
    }
    if (!expanded.has(key)) {
      expand(key, path)
      return
    }
    const next = new Map(expanded)
    next.delete(key)
    setExpanded(next)
  }

  const collapseAll = (): void => {
    if (filtered !== null) setFilterOverrides(collapseFilterView(filtered, filterOverrides))
    else setExpanded(new Map())
  }

  /** 在目录中显示：展开到对象，行出现即滚入视口；所在的库没显示时，showDatabase 为真即先勾上它，否则不显示 */
  const reveal = (object: CatalogObject, showDatabase: boolean): void => {
    const { database } = object.path
    if (shown !== undefined && database !== undefined && !shown.databases.includes(database)) {
      if (!showDatabase) return
      shown.onChange([...shown.databases, database])
    }
    const key = catalogObjectKey(object)
    const layers = catalogRevealLayers(object.path)
    // 筛选视图里有它（所在的层筛过后仍列着它）就只在筛选视图里展开；被筛选挡住则先清掉筛选
    const filteredLayer = filtered?.loaded.get(catalogLayerKey(object.path))
    if (
      filteredLayer !== undefined &&
      'nodes' in filteredLayer &&
      filteredLayer.nodes.some((n) => catalogNodeKey(object.path, n) === key)
    ) {
      const next = new Map(filterOverrides)
      for (const layer of layers) next.set(layer.key, true)
      setFilterOverrides(next)
    } else {
      if (filtering) updateFilter('')
      for (const layer of layers) {
        if (!expanded.has(layer.key)) expand(layer.key, layer.path)
      }
    }
    scrollToRow(key)
  }
  useImperativeHandle(ref, () => ({ refresh: () => void refresh(), reveal }))

  /**
   * 在控制台中打开：切到「控制台」一格，控制台所在的库、模式换成 path（这一行在目录里的位置）所在的；与当前一致、不在
   * 某个库里、没有控制台上下文（SQLite）时只切格
   */
  const openConsole = (path: CatalogPath): void => {
    onOpenConsole()
    const change = context == null ? null : catalogConsoleContextChange(context.kind, path)
    if (change !== null) consoleSwitch.switchTo(change)
  }
  // 控制台上下文还不知道（刚连上，主进程还在应用记住的；工具栏这时也不出「库」「模式」）：在某个库里的行（要换库、模式，
  // 见 catalogConsoleContextChange）换不了，「在控制台中打开」置灰；只切格的行（根行、角色、用户、SQLite 的各行）照常
  const contextPending = context === undefined && menu !== null && menu.path.database !== undefined
  // 置灰时悬停写明原因（同 Git 菜单的置灰项）
  const consoleDisabledReason = contextPending
    ? '正在确定控制台所在的库'
    : consoleBusy === 'run'
      ? '控制台正在执行'
      : consoleBusy !== null
        ? '控制台正在切换'
        : undefined

  /** 右键菜单：各行都有「在控制台中打开」（path 为这一行在目录里的位置），对象行另有「复制名称」（name 为对象名） */
  const openMenu = (
    e: React.MouseEvent,
    rowKey: string,
    path: CatalogPath,
    name?: string
  ): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      rowKey,
      path,
      copy: name === undefined ? undefined : { label: '复制名称', text: name }
    })
  }

  return (
    <TreePanel>
      <TreePanelBar>
        <BarInput
          ref={filterInputRef}
          value={filter}
          onChange={updateFilter}
          escapeFocusRef={scrollRef}
          leading={<Search className={BAR_INPUT_ICON} />}
          title={FILTER_HINT}
          placeholder={FILTER_HINT}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <RefreshButton
            refreshing={refreshing > 0}
            title="刷新目录"
            onClick={() => void refresh()}
          />
          <button type="button" title="全部折叠" className={TOOLBAR_BTN} onClick={collapseAll}>
            <ChevronsDownUp className="size-4" />
          </button>
        </div>
      </TreePanelBar>
      <TreeRootRow
        title={name}
        icon={<Database className={TREE_ICON} />}
        name={name}
        actions={
          shown !== undefined && databases !== null ? (
            <ShownDatabasesCombobox
              all={databases.all}
              listed={databases.listed}
              onChange={shown.onChange}
            />
          ) : undefined
        }
        menuActive={menu?.rowKey === ROOT_ROW_KEY}
        onContextMenu={(e) => openMenu(e, ROOT_ROW_KEY, {})}
        onDisconnect={onDisconnect}
      />
      <div
        ref={scrollRef}
        tabIndex={0}
        className={TREE_SCROLL}
        // 焦点在树上打字转进树顶的筛选
        onKeyDown={(e) =>
          typeToInput(e, {
            query: filter,
            inputRef: filterInputRef,
            onChange: updateFilter,
            onClear: () => updateFilter('')
          })
        }
      >
        {shownRoot === undefined || filterPending ? (
          <TreeHint loading>正在读取…</TreeHint>
        ) : filterEmpty ? (
          <TreeHint>无匹配对象</TreeHint>
        ) : filtered === null && 'nodes' in shownRoot && shownRoot.nodes.length === 0 ? (
          <TreeHint>没有对象</TreeHint>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index]!
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {row.kind === 'notice' ? (
                    <TreeNoticeRow depth={row.depth} message={row.message} loading={row.loading} />
                  ) : (
                    <CatalogNodeRow
                      depth={row.depth}
                      path={row.path}
                      node={row.node}
                      expanded={displayExpanded.has(row.key)}
                      selected={selectedKey === row.key}
                      menuActive={menu?.rowKey === row.key}
                      onClick={() =>
                        row.node.kind === 'object'
                          ? onOpenObject({
                              path: row.path,
                              name: row.node.name,
                              detail: row.node.detail
                            })
                          : toggle(row.key, childPath(row.path, row.node))
                      }
                      onMenu={(e) =>
                        openMenu(
                          e,
                          row.key,
                          childPath(row.path, row.node),
                          row.node.kind === 'object' ? row.node.name : undefined
                        )
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <DataSourceTreeMenu
        menu={menu}
        onOpenConsole={menu === null ? undefined : () => openConsole(menu.path)}
        consoleDisabled={consoleSwitch.disabled || contextPending}
        consoleDisabledReason={consoleDisabledReason}
        onClose={() => setMenu(null)}
      />
      {consoleSwitch.failure !== null && (
        <ErrorDialog
          title={consoleSwitch.failure.title}
          message={consoleSwitch.failure.message}
          onClose={consoleSwitch.dismiss}
        />
      )}
    </TreePanel>
  )
}

/**
 * 根行的「N / M 个库」：点开是可筛选的勾选列表（多选的 ui/combobox），列根这一层的库（all），勾着的为显示的（listed）；
 * 勾上 / 取消即把新的名单交给 onChange（按勾上的先后，新勾的在最后）。
 */
function ShownDatabasesCombobox({
  all,
  listed,
  onChange
}: {
  all: string[]
  listed: string[]
  onChange: (databases: string[]) => void
}): React.JSX.Element {
  return (
    <Combobox items={all} multiple value={listed} onValueChange={onChange}>
      <ComboboxTrigger title="显示的库" className={SHOWN_TRIGGER}>
        {`${listed.length} / ${all.length} 个库`}
      </ComboboxTrigger>
      <ComboboxContent align="end" className="max-w-80">
        <ComboboxInput placeholder="筛选库…" />
        <ComboboxEmpty>{all.length === 0 ? '没有库' : '没有匹配的库'}</ComboboxEmpty>
        <ComboboxList>
          {(database: string) => (
            <ComboboxItem key={database} value={database} title={database}>
              {database}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function CatalogNodeRow({
  depth,
  path,
  node,
  expanded,
  selected,
  menuActive,
  onClick,
  onMenu
}: {
  depth: number
  path: CatalogPath
  node: CatalogNode
  expanded: boolean
  selected: boolean
  menuActive: boolean
  onClick: () => void
  /** 右键：出这一行的菜单 */
  onMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const label = node.kind === 'group' ? CATALOG_GROUP_LABELS[node.group] : node.name
  const extra =
    node.kind === 'group' ? node.count : node.kind === 'object' ? node.detail : undefined
  return (
    <TreeRow
      depth={depth}
      expanded={node.kind === 'object' ? undefined : expanded}
      icon={nodeIcon(path, node)}
      name={label}
      extra={extra}
      title={extra === undefined ? label : `${label} ${extra}`}
      selected={selected}
      menuActive={menuActive}
      onClick={onClick}
      onContextMenu={onMenu}
    />
  )
}
