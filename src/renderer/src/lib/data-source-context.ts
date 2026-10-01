// Data Source Tab 的控制台上下文（主进程推送，见 shared/data-source-context）：控制台在哪个库上执行，Redis 另为键列表所在的
// 库；切换它（SQL 控制台工具栏的「库」「模式」、目录右键「在控制台中打开」、Redis 的库编号下拉、点 Redis 最近打开里别的
// 库的键共用），它正被什么占着（执行与切换互斥）；跟着它的补全范围（与表数据的 WHERE / ORDER BY 框、运行配置对话框里按
// 「数据源 + 库」的补全）；以及「库」「模式」列出的库与模式、Redis 各库的键数（打开时读）。
import { useEffect, useMemo, useState } from 'react'
import { useDataSourceUi, type ConsoleBusy } from '@renderer/data-source-store'
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import { useSpinUntilRest } from '@renderer/lib/use-spin-until-rest'
import type { DataSourceTarget } from '@shared/data-source'
import type { CatalogPath, CatalogResult } from '@shared/data-source-catalog'
import {
  consoleContextChangeLevels,
  consoleContextFailureLevel,
  isCurrentConsoleContext,
  type ConsoleContext,
  type ConsoleContextChange,
  type ConsoleContextEvent,
  type ConsoleContextFailure,
  type ConsoleContextLevel
} from '@shared/data-source-context'
import {
  consoleSearchPath,
  queryFailureText,
  type CompletionSchema
} from '@shared/data-source-query'
import type { RedisDatabasesResult } from '@shared/redis'

// 各个 Data Source Tab 共用一个底层推送监听，按 Tab 键分发
const subscribeContext = createKeyedSubscription(
  window.api.onDataSourceConsoleContextChanged,
  (event) => event.tabKey
)

const contextOf = (event: ConsoleContextEvent): ConsoleContext | null => event.context

/**
 * 控制台上下文；尚未得知为 undefined（连上后主进程应用完 Tab 记住的才交回），没有（SQLite、读不出来）为 null。
 * Data Source Tab 读这一份，往下交给控制台与树。
 */
export function useConsoleContext(tabKey: string): ConsoleContext | null | undefined {
  return useKeyedPushed(tabKey, subscribeContext, window.api.getDataSourceConsoleContext, contextOf)
}

/** 控制台上下文正被什么占着（控制台执行中、切换中，见 data-source-store 的 consoleBusyByTab）；没被占着为 null。 */
export function useConsoleBusy(tabKey: string): ConsoleBusy | null {
  return useDataSourceUi((s) => s.consoleBusyByTab[tabKey] ?? null)
}

/**
 * 切换控制台上下文：与控制台执行互斥——控制台正在执行（或已在切换）时不切，为 busy；切换中占着控制台上下文，记下要变的
 * 各级（context 为现在的控制台上下文，见 consoleContextChangeLevels 与 data-source-store 的 consoleBusyByTab：要变的下拉
 * 转圈，其余与「执行」置灰）。切过去了为 null（主进程回查并推送，下拉、键列表随之变）；切不过去（库连不上、库编号超出
 * 范围、无权、Redis 的控制台开着事务等）交回原因（错误框的标题与正文见 contextSwitchFailure）。
 */
export async function switchConsoleContext(
  tabKey: string,
  context: ConsoleContext | null | undefined,
  change: ConsoleContextChange
): Promise<ConsoleContextFailure | 'busy' | null> {
  const { consoleBusyByTab, setConsoleBusy } = useDataSourceUi.getState()
  if (consoleBusyByTab[tabKey] !== undefined) return 'busy'
  setConsoleBusy(tabKey, consoleContextChangeLevels(context, change))
  try {
    return await window.api.switchDataSourceConsoleContext(tabKey, change)
  } finally {
    setConsoleBusy(tabKey, null)
  }
}

/** 切不过去时错误框的标题：按没切过去的那一级（见 consoleContextFailureLevel）。 */
const SWITCH_FAILURE_TITLES = { database: '无法切换库', schema: '无法切换模式' } as const

/** 切不过去：错误框的标题与正文（原因）。 */
export interface ContextSwitchFailure {
  title: string
  message: string
}

/**
 * 切不过去（switchConsoleContext 交回的原因）时错误框的标题与正文：标题按没切过去的那一级（「无法切换库」「无法切换
 * 模式」），正文为原因，无权为「无权切换」。useContextSwitch 与 Redis 点最近打开里别的库的键共用。
 */
export function contextSwitchFailure(
  context: ConsoleContext | null | undefined,
  change: ConsoleContextChange,
  failure: ConsoleContextFailure
): ContextSwitchFailure {
  return {
    title: SWITCH_FAILURE_TITLES[consoleContextFailureLevel(context, change, failure)],
    message: queryFailureText(failure, '无权切换')
  }
}

/**
 * 切换控制台上下文的一套（「库」「模式」、Redis 的库编号下拉与目录右键「在控制台中打开」共用）：与同一个 Tab 的控制台
 * 执行互斥——执行中、切换中置灰（disabled）；给了 level（钮管的是库还是模式）时，切换中它要变（不论从哪里发起）还转圈
 * （spin，见 useSpinUntilRest；转回原位前一直置灰）；控制台上下文还不知道或没有、点的就是当前那一项时不切；切不过去的
 * 标题与原因记在 failure（见 contextSwitchFailure；弹错误框，点「确定」经 dismiss 清掉）。
 */
export function useContextSwitch(
  tabKey: string,
  context: ConsoleContext | null | undefined,
  level?: ConsoleContextLevel
): {
  disabled: boolean
  spin: ReturnType<typeof useSpinUntilRest>
  switchTo: (change: ConsoleContextChange) => void
  failure: ContextSwitchFailure | null
  dismiss: () => void
} {
  const busy = useConsoleBusy(tabKey)
  const spin = useSpinUntilRest(level !== undefined && Array.isArray(busy) && busy.includes(level))
  const [failure, setFailure] = useState<ContextSwitchFailure | null>(null)

  const switchTo = async (change: ConsoleContextChange): Promise<void> => {
    if (context == null || isCurrentConsoleContext(context, change)) return
    const result = await switchConsoleContext(tabKey, context, change)
    if (result !== null && result !== 'busy') {
      setFailure(contextSwitchFailure(context, change, result))
    }
  }

  return {
    disabled: busy !== null || spin.spinning,
    spin,
    switchTo: (change) => void switchTo(change),
    failure,
    dismiss: () => setFailure(null)
  }
}

/**
 * 换上另一份不写前缀时查找的模式或库（searchPath 为它的 JSON 文字，便于作依赖；null 为不换）；相同时仍用原来的对象
 * （调用方据它建编辑器的语言，对象变了编辑器要重新配置、补全器要重建）。
 */
function withSearchPath(
  schema: CompletionSchema | null,
  searchPath: string | null
): CompletionSchema | null {
  if (schema === null || searchPath === null || JSON.stringify(schema.searchPath) === searchPath) {
    return schema
  }
  return { ...schema, searchPath: JSON.parse(searchPath) as string[] }
}

/** 控制台上下文对应的 searchPath 的 JSON 文字（见 consoleSearchPath）；还没得知、没有（SQLite）为 null。 */
function consoleSearchPathKey(context: ConsoleContext | null | undefined): string | null {
  return context == null || context.kind === 'redis'
    ? null
    : JSON.stringify(consoleSearchPath(context))
}

/**
 * 控制台补全用的表结构（Data Source Tab 读这一份，控制台与表数据的 WHERE / ORDER BY 框共用，见 useTableCompletion），
 * 范围跟着控制台上下文：PostgreSQL 按控制台所在的库各一份（切库即换一份），其余只有一份；先用表结构缓存、现查到了替换
 * （现查已经到了，晚到的缓存就不用了），nonce 变了（刷新目录，含控制台里改了结构之后）重读。不写前缀时查找的模式或库
 * 直接取控制台上下文（USE、SET search_path 之后不必重读整份）。上下文还没得知时先不读；都还没有为 null。
 */
export function useConsoleCompletion(
  tabKey: string,
  context: ConsoleContext | null | undefined,
  nonce: number
): CompletionSchema | null {
  const scope =
    context === undefined ? null : context?.kind === 'postgresql' ? context.database : ''
  const key = scope === null ? null : JSON.stringify([tabKey, scope])
  const schema = useCompletionSchema(tabKey, key, undefined, nonce)
  const searchPath = consoleSearchPathKey(context)
  return useMemo(() => withSearchPath(schema, searchPath), [schema, searchPath])
}

/**
 * 读补全用的表结构：先用表结构缓存、现查到了替换（现查已经到了，晚到的缓存就不用了），nonce 变了重读；key 为 null 时
 * 不读。database 不给为控制台所在的库的那份，给了为这个库的（PostgreSQL，见主进程的 readDataSourceCompletionSchema）。
 * 都还没有为 null。
 */
function useCompletionSchema(
  tabKey: string,
  key: string | null,
  database: string | undefined,
  nonce: number
): CompletionSchema | null {
  const [loaded, setLoaded] = useState<{
    key: string
    live: boolean
    schema: CompletionSchema
  } | null>(null)

  useEffect(() => {
    if (key === null) return
    let current = true
    void window.api.peekDataSourceCompletionSchema(tabKey, database).then((cached) => {
      if (!current || cached === null) return
      setLoaded((prev) =>
        prev?.key === key && prev.live ? prev : { key, live: false, schema: cached }
      )
    })
    return () => {
      current = false
    }
  }, [tabKey, key, database])

  useEffect(() => {
    if (key === null) return
    let current = true
    void window.api.readDataSourceCompletionSchema(tabKey, database).then((result) => {
      if (current && 'schemas' in result) setLoaded({ key, live: true, schema: result })
    })
    return () => {
      current = false
    }
  }, [tabKey, key, database, nonce])

  return loaded?.key === key ? loaded.schema : null
}

/**
 * 表数据 WHERE / ORDER BY 框的补全用的表结构：通常就是控制台那份（consoleCompletion，见 useConsoleCompletion；Data Source
 * Tab 读一份、两处共用，重读了两处一起换）。PostgreSQL 各库各一份：打开的表不在控制台所在的库（context 为控制台上下文）
 * 上时，同样先缓存、再现查地读它所在的库（database）的那份，nonce 变了（刷新目录）重读；在同一个库里换着打开表不重读。
 * 控制台上下文还没得知时为 null（只补关键字、内置函数与类型）。
 */
export function useTableCompletion(
  tabKey: string,
  context: ConsoleContext | null | undefined,
  database: string | undefined,
  consoleCompletion: CompletionSchema | null,
  nonce: number
): CompletionSchema | null {
  const other =
    context?.kind === 'postgresql' && context.database !== database ? database : undefined
  const key = other === undefined ? null : JSON.stringify([tabKey, other])
  const otherCompletion = useCompletionSchema(tabKey, key, other, nonce)
  if (context === undefined) return null
  return other === undefined ? consoleCompletion : otherCompletion
}

/**
 * 运行配置对话框里的补全：按「数据源 + 库」取（先取表结构缓存，没有时借连着的 Data Source Tab 现查，见主进程的
 * readDataSourceCompletionFor）。PostgreSQL 各库各一份：库留空、是数据源的默认库或是选项里的库（databases）才取，
 * 输入到一半的库名不去连；MySQL / MariaDB 与 SQLite 只有一份，不写前缀时查找填的库（留空即数据源的默认库）。Redis
 * 没有。拿不到为 null。
 */
export function useConfigCompletion(
  dataSourceId: string,
  target: DataSourceTarget,
  database: string,
  databases: readonly string[]
): CompletionSchema | null {
  const known =
    database === '' ||
    (target.kind !== 'sqlite' && database === target.database) ||
    databases.includes(database)
  const scope =
    target.kind === 'redis' ? null : target.kind !== 'postgresql' ? '' : known ? database : null
  const key = scope === null ? null : JSON.stringify([dataSourceId, scope])
  const [loaded, setLoaded] = useState<{ key: string; schema: CompletionSchema | null } | null>(
    null
  )

  useEffect(() => {
    if (key === null || scope === null) return
    let current = true
    void window.api.readDataSourceCompletionFor(dataSourceId, scope).then((schema) => {
      if (current) setLoaded({ key, schema })
    })
    return () => {
      current = false
    }
  }, [dataSourceId, scope, key])

  const schema = loaded?.key === key ? loaded.schema : null
  // MySQL / MariaDB 填了库时查找它（取的那一份按数据源的默认库）
  const searchPath =
    (target.kind === 'mysql' || target.kind === 'mariadb') && database !== ''
      ? JSON.stringify([database])
      : null
  return useMemo(() => withSearchPath(schema, searchPath), [schema, searchPath])
}

/**
 * 目录的一层（控制台工具栏「库」的列表、「模式」列出的控制台所在库的模式），列表打开时读：先取表结构缓存、同时现查，
 * 现查到了替换（现查读不出来时有缓存就留着缓存）；都还没有为 null。收起时不读、为 null，读到的丢掉，下次打开从头读。
 * database 不给为根这一层。
 */
export function useCatalogLayer(
  tabKey: string,
  open: boolean,
  database?: string
): CatalogResult | null {
  const key = open ? JSON.stringify([tabKey, database]) : null
  const [layer, setLayer] = useState<{ key: string; live: boolean; result: CatalogResult } | null>(
    null
  )
  // 收起即丢掉（渲染时就地重置，同 useSpinUntilRest）
  if (key === null && layer !== null) setLayer(null)
  useEffect(() => {
    if (key === null) return
    let current = true
    const path: CatalogPath = database === undefined ? {} : { database }
    void window.api.peekDataSourceCatalog(tabKey, path).then((cached) => {
      if (!current || cached === null) return
      setLayer((prev) =>
        prev?.key === key && prev.live ? prev : { key, live: false, result: cached }
      )
    })
    void window.api.readDataSourceCatalog(tabKey, path).then((result) => {
      if (!current) return
      setLayer((prev) =>
        'nodes' in result || prev?.key !== key ? { key, live: true, result } : prev
      )
    })
    return () => {
      current = false
    }
  }, [tabKey, database, key])
  return layer?.key === key ? layer.result : null
}

/** Redis 库的个数与各库的键数（键列表顶栏的库编号下拉打开时读）；还没读到为 null。 */
export function useRedisDatabases(tabKey: string): RedisDatabasesResult | null {
  const [loaded, setLoaded] = useState<{ tabKey: string; result: RedisDatabasesResult } | null>(
    null
  )
  useEffect(() => {
    let current = true
    void window.api.readRedisDatabases(tabKey).then((result) => {
      if (current) setLoaded({ tabKey, result })
    })
    return () => {
      current = false
    }
  }, [tabKey])
  return loaded?.tabKey === tabKey ? loaded.result : null
}
