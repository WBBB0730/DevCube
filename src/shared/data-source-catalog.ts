// Data Source Tab 右侧的目录（docs/prd/database.md「目录」）：库 → 模式 → 按对象类型分组 → 对象。
// 展开一层查一层、每次展开都重新查；分组只列有对象的，旁边给个数。PostgreSQL、MySQL / MariaDB 的根下只列显示的库（见
// catalogShownDatabases）。读到的各层存进表结构缓存，界面先显示缓存再核对；连上后、刷新目录时另在后台分两批一次读完显示
// 的库（见 catalogBulkReads）的主体结构（先是各模式的分组与表、视图，再是其余分组的对象），整理成与逐层读取一致的各层
// （见 catalogBulkGroupLayers、catalogBulkObjectLayers，哪一层在哪次读取的哪一批见 catalogBulkBatchOf）。

import type { DataSourceKind, SqlKind } from './data-source'
import { queryFailureText, type QueryFailure } from './data-source-query'

export type CatalogGroup =
  | 'tables'
  | 'views'
  | 'matviews'
  | 'functions'
  | 'procedures'
  | 'sequences'
  | 'types'
  | 'triggers'
  | 'indexes'
  | 'events'
  | 'extensions'
  | 'roles'
  | 'users'

export const CATALOG_GROUP_LABELS: Record<CatalogGroup, string> = {
  tables: '表',
  views: '视图',
  matviews: '物化视图',
  functions: '函数',
  procedures: '存储过程',
  sequences: '序列',
  types: '类型',
  triggers: '触发器',
  indexes: '索引',
  events: '事件',
  extensions: '扩展',
  roles: '角色',
  users: '用户'
}

/** 一个节点在目录里的位置：从根往下经过的库、模式与分组（各类型用到其中几项）。 */
export interface CatalogPath {
  database?: string
  schema?: string
  group?: CatalogGroup
}

export type CatalogNode =
  | { kind: 'database'; name: string }
  | { kind: 'schema'; name: string }
  /** count：分组里的对象个数；数不出来（如无权读取）时缺省 */
  | { kind: 'group'; group: CatalogGroup; count?: number }
  /** detail：同名对象的区分或补充（函数的参数表、触发器与索引所属的表） */
  | { kind: 'object'; name: string; detail?: string }

/** 目录里的一个对象：它所在的位置（含分组）、名称与区分同名对象的说明（见 CatalogNode 的 object）。 */
export interface CatalogObject {
  path: CatalogPath
  name: string
  detail?: string
}

/** 读一层目录的结果：子节点，或读不出来的原因（账号无权读取、别的错误）。 */
export type CatalogResult = { nodes: CatalogNode[] } | QueryFailure

/** 进入节点后的子节点位置。 */
export function childPath(path: CatalogPath, node: CatalogNode): CatalogPath {
  switch (node.kind) {
    case 'database':
      return { database: node.name }
    case 'schema':
      return { ...path, schema: node.name }
    case 'group':
      return { ...path, group: node.group }
    case 'object':
      return path
  }
}

/** 节点的唯一键（展开状态、虚拟滚动用）。 */
export function catalogNodeKey(path: CatalogPath, node: CatalogNode): string {
  const parent = [path.database, path.schema, path.group].map((part) => part ?? '').join('\0')
  switch (node.kind) {
    case 'database':
    case 'schema':
      return `${parent}\0${node.kind}\0${node.name}`
    case 'group':
      return `${parent}\0group\0${node.group}`
    case 'object':
      return `${parent}\0object\0${node.name}\0${node.detail ?? ''}`
  }
}

/** 对象的节点键（同 catalogNodeKey）。 */
export function catalogObjectKey(object: CatalogObject): string {
  return catalogNodeKey(object.path, { kind: 'object', name: object.name, detail: object.detail })
}

/** 对象所在那一层读到的节点里有没有它（同名且说明相同）。 */
export function catalogHasObject(nodes: readonly CatalogNode[], object: CatalogObject): boolean {
  return nodes.some(
    (node) => node.kind === 'object' && node.name === object.name && node.detail === object.detail
  )
}

/** 一层目录的键：打开这一层的那个节点的键（同 catalogNodeKey，CatalogTree 的已读各层也按它存）；根这一层为空串。 */
export function catalogLayerKey(path: CatalogPath): string {
  const { database, schema, group } = path
  if (group !== undefined) return catalogNodeKey({ database, schema }, { kind: 'group', group })
  if (schema !== undefined) return catalogNodeKey({ database }, { kind: 'schema', name: schema })
  if (database !== undefined) return catalogNodeKey({}, { kind: 'database', name: database })
  return ''
}

/**
 * 「在目录中显示」从根往下到 path 这一层要展开的各节点：节点的键（同 catalogNodeKey）与它打开的那一层的位置（同
 * childPath），依次为库、模式、分组（各类型用到其中几项）。
 */
export function catalogRevealLayers(path: CatalogPath): { key: string; path: CatalogPath }[] {
  const nodes: CatalogNode[] = []
  if (path.database !== undefined) nodes.push({ kind: 'database', name: path.database })
  if (path.schema !== undefined) nodes.push({ kind: 'schema', name: path.schema })
  if (path.group !== undefined) nodes.push({ kind: 'group', group: path.group })
  let at: CatalogPath = {}
  return nodes.map((node) => {
    at = childPath(at, node)
    return { key: catalogLayerKey(at), path: at }
  })
}

/** 一层目录：位置与读到的子节点（写进表结构缓存用）。 */
export interface CatalogLayer {
  path: CatalogPath
  nodes: CatalogNode[]
}

/**
 * 一次读完主体结构的两批，依次读：0 为第一批（各模式或库的分组与表、视图、物化视图，读完即可用），1 为第二批（其余
 * 分组的对象：函数、存储过程、序列、类型、触发器、索引、事件、扩展、角色、用户，各类型有其中几种）。
 */
export const CATALOG_BULK_BATCHES = [0, 1] as const
export type CatalogBulkBatch = (typeof CATALOG_BULK_BATCHES)[number]

/** 第一批连对象列表一起读的分组。 */
const CATALOG_BULK_FIRST_GROUPS: readonly CatalogGroup[] = ['tables', 'views', 'matviews']

/** 分组的对象列表在一次读完主体结构的哪一批读：表、视图、物化视图在第一批，其余在第二批。 */
export function catalogBulkGroupBatch(group: CatalogGroup): CatalogBulkBatch {
  return CATALOG_BULK_FIRST_GROUPS.includes(group) ? 0 : 1
}

/**
 * 一次读完主体结构里的一次读取（一条临时连接）读的库：PostgreSQL 为这条连接连到的那一个；MySQL / MariaDB 为一起读的
 * 各个显示的库；SQLite 只有一个库，为空串。
 */
export type CatalogBulkRead = readonly string[]

/**
 * 一次读完主体结构的各次读取，依次进行（见 CatalogBulkRead）：PostgreSQL 一条连接只通一个库，显示的库 shown 各读一次，
 * 连接所在的库 database 显示时排在最前，其余按 shown 的先后；MySQL / MariaDB 一条连接看得到全部库，一次读完显示的库；
 * SQLite 读一次（database 为空串）。没有显示的库时为空。
 */
export function catalogBulkReads(
  kind: SqlKind,
  database: string,
  shown: readonly string[]
): CatalogBulkRead[] {
  switch (kind) {
    case 'postgresql': {
      const ordered = shown.includes(database)
        ? [database, ...shown.filter((name) => name !== database)]
        : shown
      return ordered.map((name) => [name])
    }
    case 'mysql':
    case 'mariadb':
      return shown.length === 0 ? [] : [[...shown]]
    case 'sqlite':
      return [[database]]
  }
}

/**
 * path 这一层由一次读完主体结构里读哪个库的那次读取读出、在哪一批（见 catalogBulkReads）；根这一层现读，为 null。各库的层
 * 归它所在的库；根下不属于某个库的层（PostgreSQL 的角色、MySQL / MariaDB 的用户，每次读取都连带读）与 SQLite 的各层归
 * 第一次读取读的库 first。分组这一层在第一批，对象这一层按分组（见 catalogBulkGroupBatch）。这一层所在的库这次不读时，
 * 调用方等不到它、照常现查。
 */
export function catalogBulkBatchOf(
  kind: SqlKind,
  first: string,
  path: CatalogPath
): { database: string; batch: CatalogBulkBatch } | null {
  if (kind !== 'sqlite' && path.database === undefined && path.group === undefined) return null
  const batch = path.group === undefined ? 0 : catalogBulkGroupBatch(path.group)
  return { database: path.database ?? first, batch }
}

/**
 * 显示的库：数据源记下的 saved（按勾选的先后）；从没设置过（undefined）时为默认库 database（见 defaultDatabaseOf），
 * 没有默认库时一个都没有。
 */
export function catalogShownDatabases(
  saved: readonly string[] | undefined,
  database: string
): readonly string[] {
  if (saved !== undefined) return saved
  return database === '' ? [] : [database]
}

/** 根这一层 root 列出的库（按列出的先后）。 */
export function catalogDatabases(root: readonly CatalogNode[]): string[] {
  return root.flatMap((node) => (node.kind === 'database' ? [node.name] : []))
}

/**
 * databases 里根这一层 root 还列着的（先后不变）：显示的库里不在其中的已经删掉（从名单里去掉），勾选列表里只勾它们。
 */
export function catalogListedDatabases(
  databases: readonly string[],
  root: readonly CatalogNode[]
): string[] {
  const listed = new Set(catalogDatabases(root))
  return databases.filter((name) => listed.has(name))
}

/** 目录根这一层只留显示的库 shown；根下的分组（角色、用户）不是库，照留。读不出来的原样交回。 */
export function catalogShownRoot(root: CatalogResult, shown: readonly string[]): CatalogResult {
  if (!('nodes' in root)) return root
  return {
    nodes: root.nodes.filter((node) => node.kind !== 'database' || shown.includes(node.name))
  }
}

/** path 这一层在不在显示的库 shown 里：不在某个库里的（根、根下的分组）都算；没有显示的库（SQLite）时都算。 */
export function catalogPathShown(path: CatalogPath, shown: readonly string[] | undefined): boolean {
  return shown === undefined || path.database === undefined || shown.includes(path.database)
}

/**
 * 目录各层的表结构缓存（按层键，同 catalogLayerKey；Files 面板里直接打开的 SQLite 文件为会话内存里的那份），与这个 Tab
 * 一次读完主体结构还在不在进行：目录按名称筛选时连同已读取的各层一起找，还在读时没有匹配不算定论。
 */
export interface CatalogCachedLayers {
  layers: Record<string, CatalogResult>
  /** 一次读完主体结构还在进行：之后还会有层写进缓存 */
  reading: boolean
}

/**
 * 一次读完主体结构写进了一批、或读取结束了（读完最后一个库，或读不出来）：推给这个 Tab，进行中的目录筛选随之重取缓存
 * （见 CatalogCachedLayers）。
 */
export interface CatalogLayersEvent {
  tabKey: string
}

/** 目录查询的一行，按列名取值：列都起了别名（name / detail / g / n），跨模式一次读出时另有所在模式 s。 */
export type CatalogQueryRow = Record<string, unknown>

/** 对象列表的行整理成对象节点（name 与可选的 detail）。 */
export function catalogObjectsOf(rows: readonly CatalogQueryRow[]): CatalogNode[] {
  return rows.map((row) => ({
    kind: 'object',
    name: String(row.name),
    ...(row.detail == null ? {} : { detail: String(row.detail) })
  }))
}

/** 各分组个数的行（g、n）整理成分组节点：只留有对象的分组，顺序按 groups。 */
export function catalogGroupsOf(
  rows: readonly CatalogQueryRow[],
  groups: readonly CatalogGroup[]
): CatalogNode[] {
  const counts = new Map(rows.map((row) => [String(row.g), Number(row.n)]))
  return groups
    .filter((g) => (counts.get(g) ?? 0) > 0)
    .map((group) => ({ kind: 'group', group, count: counts.get(group)! }))
}

/** 按模式归组：跨模式一次读出的行按所在模式（s 列，没有这一列的归空串）分开，各模式内保持原来的顺序。 */
export function groupBySchema(rows: readonly CatalogQueryRow[]): Map<string, CatalogQueryRow[]> {
  const bySchema = new Map<string, CatalogQueryRow[]>()
  for (const row of rows) {
    const schema = row.s == null ? '' : String(row.s)
    const list = bySchema.get(schema)
    if (list === undefined) bySchema.set(schema, [row])
    else list.push(row)
  }
  return bySchema
}

/**
 * 一次读出的各分组个数整理成各位置的一层分组（只列有对象的），与逐层读取得到的一致。schemas 为各模式（MySQL / MariaDB
 * 为各库，SQLite 为根，名称为空串）的名称，即行里的 s，pathOf 给出它在目录里的位置；counts 为各分组个数的行（g、n、s）。
 */
export function catalogBulkGroupLayers(
  schemas: readonly string[],
  pathOf: (schema: string) => CatalogPath,
  groups: readonly CatalogGroup[],
  counts: readonly CatalogQueryRow[]
): CatalogLayer[] {
  const countsBySchema = groupBySchema(counts)
  return schemas.map((schema) => ({
    path: pathOf(schema),
    nodes: catalogGroupsOf(countsBySchema.get(schema) ?? [], groups)
  }))
}

/**
 * 一次读出的对象列表整理成各分组的一层对象，与逐层读取得到的一致。lists 为各分组的对象行（name、detail、s，按名称
 * 排序），按所在模式 s 分开，pathOf 同 catalogBulkGroupLayers；有对象的才得一层（同分组这一层只列有对象的分组）。
 */
export function catalogBulkObjectLayers(
  pathOf: (schema: string) => CatalogPath,
  lists: ReadonlyMap<CatalogGroup, readonly CatalogQueryRow[]>
): CatalogLayer[] {
  const layers: CatalogLayer[] = []
  for (const [group, rows] of lists) {
    for (const [schema, list] of groupBySchema(rows)) {
      layers.push({
        path: childPath(pathOf(schema), { kind: 'group', group }),
        nodes: catalogObjectsOf(list)
      })
    }
  }
  return layers
}

/** 读目录失败是不是因为账号没有权限：PostgreSQL 的 42501，MySQL / MariaDB 的 1044 / 1142 / 1227。 */
export function isPermissionDenied(
  kind: DataSourceKind,
  error: { code?: unknown; errno?: unknown; message: string }
): boolean {
  switch (kind) {
    case 'postgresql':
      return error.code === '42501'
    case 'mysql':
    case 'mariadb':
      return error.errno === 1044 || error.errno === 1142 || error.errno === 1227
    default:
      return false
  }
}

/**
 * 目录拍平后的一行：节点，或某个已展开节点下的一行提示（读取中 / 无权查看 / 出错 / 空）。读取中的那行标 loading，
 * 界面上稍等才出现。
 */
export type CatalogRow =
  | { kind: 'node'; key: string; depth: number; path: CatalogPath; node: CatalogNode }
  | { kind: 'notice'; key: string; depth: number; message: string; loading?: true }

/**
 * 按展开状态把目录拍平成行（虚拟滚动用）。loaded 为各已读位置（按 catalogNodeKey 的父键）的结果，
 * 没读到的已展开位置显示「正在读取…」。
 */
export function flattenCatalog(
  root: CatalogResult | undefined,
  loaded: ReadonlyMap<string, CatalogResult>,
  expanded: { has(key: string): boolean }
): CatalogRow[] {
  const rows: CatalogRow[] = []
  const walk = (
    result: CatalogResult | undefined,
    path: CatalogPath,
    depth: number,
    key: string
  ): void => {
    if (result === undefined) {
      rows.push({
        kind: 'notice',
        key: `${key}\0notice`,
        depth,
        message: '正在读取…',
        loading: true
      })
      return
    }
    if (!('nodes' in result)) {
      rows.push({ kind: 'notice', key: `${key}\0notice`, depth, message: queryFailureText(result) })
      return
    }
    if (result.nodes.length === 0) {
      rows.push({ kind: 'notice', key: `${key}\0notice`, depth, message: '空' })
      return
    }
    for (const node of result.nodes) {
      const nodeKey = catalogNodeKey(path, node)
      rows.push({ kind: 'node', key: nodeKey, depth, path, node })
      if (node.kind !== 'object' && expanded.has(nodeKey)) {
        walk(loaded.get(nodeKey), childPath(path, node), depth + 1, nodeKey)
      }
    }
  }
  walk(root, {}, 0, '')
  return rows
}
