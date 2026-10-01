// 读目录（docs/prd/database.md「目录」）：各数据库按自己的系统目录查，整理成统一的节点。
// PostgreSQL 读 pg_catalog（传进来的连接须已连在路径所指的库上）；MySQL / MariaDB 读 information_schema；
// SQLite 读 sqlite_schema。分组只列有对象的，个数与对象列表用同一条查询算，口径一致。
// 展开时逐层读（readCatalog）；连上后、刷新目录时另分两批一次读完显示的库（PostgreSQL 一个库读一次，MySQL / MariaDB
// 一次读完）的主体结构（readCatalogBulk），同样的查询改为跨模式或库、按模式归组，整理出的各层与逐层读的一致。补全用的表结构也在
// 这里读（readCompletionSchema：库、模式、表与视图的列与类型、自定义函数与类型、外键，MySQL / MariaDB 另有字符集、
// 排序规则、SHOW 的各项与用户，照 pgcli / mycli / litecli 的查询），控制台现查与一次读完主体结构共用；
// 不写前缀时查找的模式或库：其中为新连接上的（运行配置在新连接上跑），控制台用的在它的连接上另读（readSearchPath）。
// 控制台上下文（在哪个库、search_path）也在这里读与切（readConsoleContext、setSearchPath、switchDatabase）。

import {
  catalogBulkGroupBatch,
  catalogBulkGroupLayers,
  catalogBulkObjectLayers,
  catalogGroupsOf,
  catalogObjectsOf,
  type CatalogBulkBatch,
  type CatalogBulkRead,
  type CatalogGroup,
  type CatalogLayer,
  type CatalogNode,
  type CatalogPath,
  type CatalogQueryRow
} from '../shared/data-source-catalog'
import type { ConsoleContext } from '../shared/data-source-context'
import { quoteIdent, type CompletionSchema } from '../shared/data-source-query'
import {
  buildCompletionSchema,
  mysqlRoutinesOf,
  mysqlShowItemsOf,
  pgDefaultSearchPath,
  pgFunctionOf,
  sqliteForeignKeysOf,
  type Cells
} from './data-source-completion'
import { resultOf, runQuery, type SqlClient } from './data-source-connect'

/** 按列名取值的查询。 */
type Rows = (sql: string, params?: unknown[]) => Promise<CatalogQueryRow[]>

/** 对象列表查询：返回 name（与可选的 detail）两列，另带所在模式 s，按名称排序。 */
type ListSql = Partial<Record<CatalogGroup, string>>

/** PostgreSQL 列表查询的范围：一个模式（参数给出），或库里的全部模式（系统的除外；一次读完用，按 s 归组）。 */
type Scope = 'one' | 'all'

function rowsOf(c: SqlClient): Rows {
  return async (sql, params = []) => {
    const { columns, rows } = resultOf(await runQuery(c, sql, params))
    return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column.name, row[i]])))
  }
}

/** 各分组的对象个数（同一条查询里 union 起来）；bySchema 时按所在模式 s 分别数。 */
function countSql(lists: ListSql, groups: CatalogGroup[], bySchema = false): string {
  return groups
    .map((g) =>
      bySchema
        ? `select '${g}' as g, s, count(*) as n from (${lists[g]}) t group by s`
        : `select '${g}' as g, count(*) as n from (${lists[g]}) t`
    )
    .join(' union all ')
}

/**
 * 跨模式读出 groups 里在 batch 这一批读的分组（见 catalogBulkGroupBatch）的对象列表，一类一条；lists 为各分组的查询，
 * params 为它的参数。
 */
async function bulkLists(
  rows: Rows,
  lists: ListSql,
  groups: readonly CatalogGroup[],
  batch: CatalogBulkBatch,
  params: (group: CatalogGroup) => unknown[]
): Promise<Map<CatalogGroup, CatalogQueryRow[]>> {
  const result = new Map<CatalogGroup, CatalogQueryRow[]>()
  for (const group of groups) {
    if (catalogBulkGroupBatch(group) === batch) {
      result.set(group, await rows(lists[group]!, params(group)))
    }
  }
  return result
}

// —— PostgreSQL ——

/** 用户模式：系统模式（pg_catalog、information_schema、pg_toast 等）不列；column 为模式名的列 */
const pgUserSchema = (column: string): string =>
  `${column} !~ '^pg_' and ${column} <> 'information_schema'`
const PG_USER_SCHEMA = pgUserSchema('n.nspname')

/** 模式下各分组的对象列表：一个模式时参数为模式名。 */
function pgSchemaLists(scope: Scope): ListSql {
  const schema = scope === 'one' ? 'n.nspname = $1' : PG_USER_SCHEMA
  const relations = (kinds: string): string =>
    `select c.relname as name, n.nspname as s from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${schema} and c.relkind in ${kinds} order by 1`
  const routines = (kind: string): string =>
    `select p.proname as name, pg_get_function_identity_arguments(p.oid) as detail, n.nspname as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${schema} and p.prokind = '${kind}' order by 1, 2`
  return {
    tables: relations(`('r', 'p')`),
    views: relations(`('v')`),
    matviews: relations(`('m')`),
    functions: routines('f'),
    procedures: routines('p'),
    sequences: relations(`('S')`),
    // 独立的复合类型、枚举、域、范围；表的行类型不算
    types: `select t.typname as name, n.nspname as s from pg_type t join pg_namespace n on n.oid = t.typnamespace where ${schema} and t.typtype in ('c', 'd', 'e', 'm', 'r') and (t.typtype <> 'c' or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c') order by 1`,
    triggers: `select tg.tgname as name, c.relname as detail, n.nspname as s from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace where ${schema} and not tg.tgisinternal order by 1, 2`
  }
}

const PG_ONE_SCHEMA = pgSchemaLists('one')
const PG_ALL_SCHEMAS = pgSchemaLists('all')
const PG_SCHEMA_GROUPS: CatalogGroup[] = [
  'tables',
  'views',
  'matviews',
  'functions',
  'procedures',
  'sequences',
  'types',
  'triggers'
]
const PG_ROLES = `select rolname as name from pg_roles where rolname !~ '^pg_' order by 1`
const PG_EXTENSIONS = `select extname as name, extversion as detail from pg_extension order by 1`
const PG_DATABASES =
  'select datname as name from pg_database where datallowconn and not datistemplate order by 1'
const PG_SCHEMAS = `select n.nspname as name from pg_namespace n where ${PG_USER_SCHEMA} order by 1`

async function pgCatalog(pgRows: Rows, path: CatalogPath): Promise<CatalogNode[]> {
  if (path.group === 'roles') return catalogObjectsOf(await pgRows(PG_ROLES))
  if (path.database === undefined) {
    const databases = await pgRows(PG_DATABASES)
    const [roles] = await pgRows(`select count(*) as n from (${PG_ROLES}) t`)
    return [
      ...databases.map((row): CatalogNode => ({ kind: 'database', name: String(row.name) })),
      { kind: 'group', group: 'roles', count: Number(roles!.n) }
    ]
  }
  if (path.group === 'extensions') return catalogObjectsOf(await pgRows(PG_EXTENSIONS))
  if (path.schema === undefined) {
    const schemas = await pgRows(PG_SCHEMAS)
    const [extensions] = await pgRows(`select count(*) as n from (${PG_EXTENSIONS}) t`)
    return [
      ...schemas.map((row): CatalogNode => ({ kind: 'schema', name: String(row.name) })),
      ...catalogGroupsOf([{ g: 'extensions', n: extensions!.n }], ['extensions'])
    ]
  }
  if (path.group === undefined) {
    const rows = await pgRows(countSql(PG_ONE_SCHEMA, PG_SCHEMA_GROUPS), [path.schema])
    return catalogGroupsOf(rows, PG_SCHEMA_GROUPS)
  }
  return catalogObjectsOf(await pgRows(PG_ONE_SCHEMA[path.group]!, [path.schema]))
}

/**
 * 库 database 的主体结构的一批：第一批为这一层（模式与扩展）与其下各模式的分组和表、视图、物化视图，第二批为各模式其余
 * 分组的对象与这个库的扩展、根下的角色。各模式的分组与对象跨模式一次读出，其余各层同逐层读。
 */
async function pgBulk(
  pgRows: Rows,
  database: string,
  batch: CatalogBulkBatch
): Promise<CatalogLayer[]> {
  const pathOf = (schema: string): CatalogPath => ({ database, schema })
  const layer = async (path: CatalogPath): Promise<CatalogLayer> => ({
    path,
    nodes: await pgCatalog(pgRows, path)
  })
  const lists = await bulkLists(pgRows, PG_ALL_SCHEMAS, PG_SCHEMA_GROUPS, batch, () => [])
  const objects = catalogBulkObjectLayers(pathOf, lists)
  if (batch === 1) {
    return [
      ...objects,
      await layer({ database, group: 'extensions' }),
      await layer({ group: 'roles' })
    ]
  }
  const databaseLayer = await layer({ database })
  const schemas = databaseLayer.nodes.flatMap((node) => (node.kind === 'schema' ? [node.name] : []))
  const counts = await pgRows(countSql(PG_ALL_SCHEMAS, PG_SCHEMA_GROUPS, true))
  return [
    databaseLayer,
    ...catalogBulkGroupLayers(schemas, pathOf, PG_SCHEMA_GROUPS, counts),
    ...objects
  ]
}

// —— MySQL / MariaDB ——

/** 系统库：不列 */
const MYSQL_SYSTEM_DATABASES = `('information_schema', 'mysql', 'performance_schema', 'sys')`

/** count 个参数的占位（`?, ?, …`）。 */
const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ')

/**
 * 库下各分组的对象列表：count 个库，参数为库名（逐层读为一个，一次读完为显示的各库、按 s 归组）；不给 count 为全部库
 * （系统库除外，补全用）。
 */
function mysqlDatabaseLists(count?: number): ListSql {
  const of = (column: string): string =>
    count === undefined
      ? `${column} not in ${MYSQL_SYSTEM_DATABASES}`
      : `${column} in (${placeholders(count)})`
  const routines = (type: string): string =>
    `select routine_name as name, routine_schema as s from information_schema.routines where ${of('routine_schema')} and routine_type = '${type}' order by 1`
  return {
    tables: `select table_name as name, table_schema as s from information_schema.tables where ${of('table_schema')} and table_type = 'BASE TABLE' order by 1`,
    views: `select table_name as name, table_schema as s from information_schema.tables where ${of('table_schema')} and table_type = 'VIEW' order by 1`,
    procedures: routines('PROCEDURE'),
    functions: routines('FUNCTION'),
    triggers: `select trigger_name as name, event_object_table as detail, trigger_schema as s from information_schema.triggers where ${of('trigger_schema')} order by 1, 2`,
    events: `select event_name as name, event_schema as s from information_schema.events where ${of('event_schema')} order by 1`
  }
}

const MYSQL_ONE_DATABASE = mysqlDatabaseLists(1)
const MYSQL_ALL_DATABASES = mysqlDatabaseLists()
const MYSQL_DATABASE_GROUPS: CatalogGroup[] = [
  'tables',
  'views',
  'procedures',
  'functions',
  'triggers',
  'events'
]
const MYSQL_DATABASES = `select schema_name as name from information_schema.schemata where schema_name not in ${MYSQL_SYSTEM_DATABASES} order by 1`
const MYSQL_USERS = 'select user as name, host as detail from mysql.user order by 1, 2'

async function mysqlCatalog(mysqlRows: Rows, path: CatalogPath): Promise<CatalogNode[]> {
  if (path.group === 'users') return catalogObjectsOf(await mysqlRows(MYSQL_USERS))
  if (path.database === undefined) {
    const databases = await mysqlRows(MYSQL_DATABASES)
    // 用户表多半要额外权限：数不出来时分组照列、不带个数，展开时再显示「无权查看」
    const users = await mysqlRows(`select count(*) as n from mysql.user`).then(
      ([row]) => Number(row!.n),
      () => undefined
    )
    return [
      ...databases.map((row): CatalogNode => ({ kind: 'database', name: String(row.name) })),
      { kind: 'group', group: 'users', ...(users === undefined ? {} : { count: users }) }
    ]
  }
  if (path.group === undefined) {
    const sql = countSql(MYSQL_ONE_DATABASE, MYSQL_DATABASE_GROUPS)
    const rows = await mysqlRows(
      sql,
      MYSQL_DATABASE_GROUPS.map(() => path.database)
    )
    return catalogGroupsOf(rows, MYSQL_DATABASE_GROUPS)
  }
  return catalogObjectsOf(await mysqlRows(MYSQL_ONE_DATABASE[path.group]!, [path.database]))
}

/**
 * 显示的库 databases（MySQL 的库即模式）主体结构的一批：第一批为各库的分组与表、视图，第二批为其余分组的对象与根下的
 * 用户。各库的分组与对象跨库一次读出，用户这一层同逐层读；已经删掉的库不写。
 */
async function mysqlBulk(
  mysqlRows: Rows,
  databases: readonly string[],
  batch: CatalogBulkBatch
): Promise<CatalogLayer[]> {
  const pathOf = (database: string): CatalogPath => ({ database })
  const lists = mysqlDatabaseLists(databases.length)
  const listed = await bulkLists(mysqlRows, lists, MYSQL_DATABASE_GROUPS, batch, () => [
    ...databases
  ])
  const objects = catalogBulkObjectLayers(pathOf, listed)
  if (batch === 1) {
    // 用户表多半要额外权限：读不出来即不写这一层（展开时现查、显示「无权查看」），不影响其余的
    const path: CatalogPath = { group: 'users' }
    const users = await mysqlCatalog(mysqlRows, path).then(
      (nodes): CatalogLayer[] => [{ path, nodes }],
      () => []
    )
    return [...objects, ...users]
  }
  const existing = await mysqlRows(
    `select schema_name as name from information_schema.schemata where schema_name in (${placeholders(databases.length)}) order by 1`,
    [...databases]
  )
  const counts = await mysqlRows(
    countSql(lists, MYSQL_DATABASE_GROUPS, true),
    MYSQL_DATABASE_GROUPS.flatMap(() => databases)
  )
  return [
    ...catalogBulkGroupLayers(
      existing.map((row) => String(row.name)),
      pathOf,
      MYSQL_DATABASE_GROUPS,
      counts
    ),
    ...objects
  ]
}

// —— SQLite ——

/**
 * 用户对象：sqlite_ 开头的系统对象不算，虚拟表（如 FTS5 全文检索）自己存数据用的影子表（pragma_table_list 里 type 为
 * shadow，Datasette 也按它隐藏）也不算；目录各层、一次读完与补全共用。column 为对象名的列
 */
const sqliteUserObject = (column: string): string =>
  `${column} not like 'sqlite\\_%' escape '\\' and ${column} not in (select name from pragma_table_list where schema = 'main' and type = 'shadow')`

const SQLITE_OBJECTS = `from sqlite_schema where type = ? and ${sqliteUserObject('name')} order by 1`
const SQLITE_LISTS: ListSql = {
  tables: `select name ${SQLITE_OBJECTS}`,
  views: `select name ${SQLITE_OBJECTS}`,
  indexes: `select name, tbl_name as detail ${SQLITE_OBJECTS}`,
  triggers: `select name, tbl_name as detail ${SQLITE_OBJECTS}`
}
const SQLITE_GROUPS: CatalogGroup[] = ['tables', 'views', 'indexes', 'triggers']
const SQLITE_TYPES: Partial<Record<CatalogGroup, string>> = {
  tables: 'table',
  views: 'view',
  indexes: 'index',
  triggers: 'trigger'
}

/** 各分组个数的行（根这一层）。 */
function sqliteCounts(sqliteRows: Rows): Promise<CatalogQueryRow[]> {
  return sqliteRows(
    countSql(SQLITE_LISTS, SQLITE_GROUPS),
    SQLITE_GROUPS.map((g) => SQLITE_TYPES[g])
  )
}

async function sqliteCatalog(sqliteRows: Rows, path: CatalogPath): Promise<CatalogNode[]> {
  if (path.group === undefined)
    return catalogGroupsOf(await sqliteCounts(sqliteRows), SQLITE_GROUPS)
  return catalogObjectsOf(await sqliteRows(SQLITE_LISTS[path.group]!, [SQLITE_TYPES[path.group]]))
}

/** SQLite 没有模式（行不带 s，都在根下）：第一批为根这一层（分组）与表、视图，第二批为索引与触发器。 */
async function sqliteBulk(sqliteRows: Rows, batch: CatalogBulkBatch): Promise<CatalogLayer[]> {
  const pathOf = (): CatalogPath => ({})
  const lists = await bulkLists(sqliteRows, SQLITE_LISTS, SQLITE_GROUPS, batch, (g) => [
    SQLITE_TYPES[g]
  ])
  const objects = catalogBulkObjectLayers(pathOf, lists)
  if (batch === 1) return objects
  const counts = await sqliteCounts(sqliteRows)
  return [...catalogBulkGroupLayers([''], pathOf, SQLITE_GROUPS, counts), ...objects]
}

/** 读 path 这一层的子节点。PostgreSQL 的连接须已连在 path.database 上（没有库时为默认库）。 */
export function readCatalog(c: SqlClient, path: CatalogPath): Promise<CatalogNode[]> {
  const rows = rowsOf(c)
  switch (c.kind) {
    case 'postgresql':
      return pgCatalog(rows, path)
    case 'mysql':
      return mysqlCatalog(rows, path)
    case 'sqlite':
      return sqliteCatalog(rows, path)
  }
}

/**
 * 一次读出主体结构里一次读取（read，见 CatalogBulkRead）的一批：连上后、刷新目录时在后台依次读两批，写进表结构缓存。
 * 第一批为各模式（MySQL / MariaDB 为各库）的分组与个数，其中的表、视图、物化视图，PostgreSQL 另有库这一层（模式与扩展）；
 * 第二批为其余分组的对象（名字与说明，同逐层读），PostgreSQL 另有扩展与根下的角色，MySQL / MariaDB 另有根下的用户。各模式
 * 的对象按类型一类一条查询，跨模式或库，各层与逐层读的一致；哪一层在哪一批见 catalogBulkBatchOf。PostgreSQL 的连接须已
 * 连在 read 那个库上。
 */
export function readCatalogBulk(
  c: SqlClient,
  read: CatalogBulkRead,
  batch: CatalogBulkBatch
): Promise<CatalogLayer[]> {
  const rows = rowsOf(c)
  switch (c.kind) {
    case 'postgresql':
      return pgBulk(rows, read[0]!, batch)
    case 'mysql':
      return mysqlBulk(rows, read, batch)
    case 'sqlite':
      return sqliteBulk(rows, batch)
  }
}

/** 按位置取值的查询：不是字符串的值为 null。 */
function cellsOf(c: SqlClient): (sql: string, params?: unknown[]) => Promise<(string | null)[][]> {
  return async (sql, params = []) => {
    const { rows } = resultOf(await runQuery(c, sql, params))
    return rows.map((row) => row.map((v) => (typeof v === 'string' ? v : null)))
  }
}

/** 各行的第一列（名字的列表）。 */
function firstCells(rows: readonly Cells[]): string[] {
  return rows.flatMap(([value]) => (value == null ? [] : [value]))
}

// —— 补全（照 pgcli / mycli / litecli 读表结构的查询，系统库与系统模式不算）——

/**
 * PostgreSQL 表与视图的各列（pgcli 的 columns 查询，另带是否视图；没有列的表也列出，见 CompletionRows.columns）：
 * 类型为 regtype 的写法，默认值为 pg_get_expr。
 */
const PG_COMPLETION_COLUMNS = `select n.nspname, c.relname, c.relkind in ('v', 'm'), a.attname, a.atttypid::regtype::text, a.atthasdef, pg_get_expr(d.adbin, d.adrelid, true) from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relkind in ('r', 'p', 'f', 'v', 'm') and ${PG_USER_SCHEMA} order by 1, 2, a.attnum`

/** PostgreSQL 的函数（pgcli 的 functions 查询，PostgreSQL 11 起；数组以 JSON 取回，见 pgFunctionOf）。 */
const PG_COMPLETION_FUNCTIONS = `select n.nspname, p.proname, to_json(p.proargnames), to_json(coalesce(p.proallargtypes::regtype[], p.proargtypes::regtype[])::text[]), to_json(p.proargmodes), p.prorettype::regtype::text, p.prokind = 'a', p.prokind = 'w', p.proretset, d.objid is not null, pg_get_expr(p.proargdefaults, 0) from pg_proc p join pg_namespace n on n.oid = p.pronamespace left join pg_depend d on d.objid = p.oid and d.deptype = 'e' where p.prorettype <> 'trigger'::regtype and ${PG_USER_SCHEMA} order by 1, 2`

/** PostgreSQL 的自定义类型（pgcli 的 datatypes 查询）：表的行类型与数组类型不算。 */
const PG_COMPLETION_TYPES = `select n.nspname, t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where (t.typrelid = 0 or (select c.relkind = 'c' from pg_class c where c.oid = t.typrelid)) and not exists (select 1 from pg_type el where el.oid = t.typelem and el.typarray = t.oid) and ${PG_USER_SCHEMA} order by 1, 2`

/** PostgreSQL 的外键（pgcli 的 foreignkeys 查询）：多列外键按列拆开，父表与子表的列一一对应。 */
const PG_FOREIGN_KEYS = `select s_p.nspname, t_p.relname, unnest((select array_agg(attname order by i) from (select unnest(confkey) as attnum, generate_subscripts(confkey, 1) as i) x join pg_attribute c using (attnum) where c.attrelid = fk.confrelid)), s_c.nspname, t_c.relname, unnest((select array_agg(attname order by i) from (select unnest(conkey) as attnum, generate_subscripts(conkey, 1) as i) x join pg_attribute c using (attnum) where c.attrelid = fk.conrelid)) from pg_constraint fk join pg_class t_p on t_p.oid = fk.confrelid join pg_namespace s_p on s_p.oid = t_p.relnamespace join pg_class t_c on t_c.oid = fk.conrelid join pg_namespace s_c on s_c.oid = t_c.relnamespace where fk.contype = 'f' and ${pgUserSchema('s_c.nspname')}`

/**
 * MySQL / MariaDB 各库的列（同 mycli 取 information_schema.columns）：类型为 COLUMN_TYPE（枚举列的取值从中解析），
 * 是否视图由各库的视图列表（与目录共用的查询）补上。
 */
const MYSQL_COMPLETION_COLUMNS = `select table_schema, table_name, column_name, column_type, column_default is not null, column_default from information_schema.columns where table_schema not in ${MYSQL_SYSTEM_DATABASES} order by 1, 2, ordinal_position`

/** MySQL / MariaDB 的存储函数与存储过程，连同函数的参数（见 mysqlRoutinesOf）。 */
const MYSQL_COMPLETION_ROUTINES = `select r.routine_schema, r.routine_name, r.routine_type, r.dtd_identifier, p.parameter_name, p.dtd_identifier from information_schema.routines r left join information_schema.parameters p on p.specific_schema = r.routine_schema and p.specific_name = r.specific_name and p.routine_type = r.routine_type and p.ordinal_position > 0 where r.routine_schema not in ${MYSQL_SYSTEM_DATABASES} order by 1, 2, p.ordinal_position`

/**
 * MySQL / MariaDB 的 SHOW 之后的项目（mycli 的 show_candidates_query：帮助表里 SHOW 开头的主题，见 mysqlShowItemsOf）与
 * 用户（mycli 的 users_query：'user'@'host'）。字符串改用单引号：sql_mode 含 ANSI_QUOTES 时双引号是标识符。
 */
const MYSQL_SHOW_ITEMS = "select name from mysql.help_topic where name like 'SHOW %'"
const MYSQL_COMPLETION_USERS = "select concat('''', user, '''@''', host, '''') from mysql.user"

/** MySQL / MariaDB 的外键：父表在前、子表在后（同 PG_FOREIGN_KEYS 的列次序）。 */
const MYSQL_FOREIGN_KEYS = `select referenced_table_schema, referenced_table_name, referenced_column_name, table_schema, table_name, column_name from information_schema.key_column_usage where referenced_table_name is not null and table_schema not in ${MYSQL_SYSTEM_DATABASES}`

/** SQLite 的表与视图（补全逐个读它们的列，见 sqliteCompletionColumns），模式都是 main：名字、是否视图。 */
const SQLITE_COMPLETION_RELATIONS = `select name, type = 'view' from sqlite_schema where type in ('table', 'view') and ${sqliteUserObject('name')} order by name`

/**
 * SQLite 一张表或视图的列（litecli 取 pragma_table_info）：列名、类型、有无默认值、默认值。改取 pragma_table_xinfo：
 * table_info 不列生成列，而表数据里看得到、WHERE / ORDER BY 里也能用；xinfo 另列出的虚拟表隐藏列（hidden 为 1）照旧
 * 不算。
 */
const SQLITE_COMPLETION_COLUMNS =
  'select name, type, dflt_value is not null, dflt_value from pragma_table_xinfo(?) where hidden <> 1 order by cid'

/** SQLite 的外键（见 sqliteForeignKeysOf）：子表、子表的列、父表、父表的列、在外键里的第几列。 */
const SQLITE_FOREIGN_KEYS = `select m.name, f."from", f."table", f."to", f.seq from sqlite_schema m join pragma_foreign_key_list(m.name) f where m.type = 'table' and ${sqliteUserObject('m.name')}`

/**
 * SQLite 各表的主键列（按在主键里的次序）：外键没写父表的列时即引用它。只读普通表（含影子表）：虚拟表不能作外键的
 * 父表，读它的列又要连上它的模块（模块没注册时出错）。
 */
const SQLITE_PRIMARY_KEYS = `select l.name, p.name from pragma_table_list l join pragma_table_info(l.name) p where l.schema = 'main' and l.type in ('table', 'shadow') and p.pk > 0 order by l.name, p.pk`

/**
 * SQLite 表与视图的各列（行同 CompletionRows.columns），逐个读：取不到列的只列名字、不带列，其余照常。未注册模块的
 * 虚拟表（如 zipfile、SpatiaLite 的模块）读列要连上它的模块，视图读列要解析它的查询（引用了这类虚拟表、没有的函数或
 * 已删掉的表时出错），连表一次读完会因为其中一个整个失败。只放过 SQLite 报的这类一般错误（SQLITE_ERROR），连接断开、
 * 被取消等照常失败。
 */
async function sqliteCompletionColumns(c: SqlClient): Promise<Cells[]> {
  const cells = cellsOf(c)
  const columns: Cells[] = []
  for (const [name, isView] of await cells(SQLITE_COMPLETION_RELATIONS)) {
    if (name == null) continue
    const rows = await cells(SQLITE_COMPLETION_COLUMNS, [name]).catch((error: unknown) => {
      if ((error as { code?: unknown }).code === 'SQLITE_ERROR') return []
      throw error
    })
    if (rows.length === 0) columns.push(['main', name, isView, null, null, null, null])
    for (const row of rows) columns.push(['main', name, isView, ...row])
  }
  return columns
}

/**
 * PostgreSQL 会话开始时的 search_path（reset_val，不随 SET 改变）与登录的用户：算新连接上的查找次序用（见
 * pgDefaultSearchPath）。
 */
const PG_DEFAULT_SEARCH_PATH =
  "select reset_val, session_user from pg_settings where name = 'search_path'"

/**
 * 不写前缀时查找的模式或库（补全用，随这条连接上的 set search_path、use 而变）：PostgreSQL 为实际的查找次序
 * current_schemas(true)（同 pgcli，含隐含的 pg_catalog），MySQL / MariaDB 为连接当前的库（没选为空），SQLite 为 main。
 */
export async function readSearchPath(c: SqlClient): Promise<string[]> {
  switch (c.kind) {
    case 'postgresql':
      return firstCells(await cellsOf(c)('select unnest(current_schemas(true))'))
    case 'mysql':
      return firstCells(await cellsOf(c)('select database()'))
    case 'sqlite':
      return ['main']
  }
}

/**
 * 补全用的表结构（系统库与系统模式不算）：库、模式、表与视图的列（带类型与默认值）、自定义函数与类型、外键，与不写
 * 前缀时查找的模式或库——PostgreSQL 为新连接上的（见 pgDefaultSearchPath：读的若是控制台的连接，SET 过 search_path
 * 也不算，免得写进缓存、用到运行配置上），其余同 readSearchPath。PostgreSQL 为连接所在的库；MySQL / MariaDB 为全部库
 * （另有存储过程，与字符集、排序规则、SHOW 的各项和用户，这几项读不出来即没有）；SQLite 为这个文件（没有自定义函数
 * 与类型）。控制台现查补全与一次读完主体结构共用。
 */
export async function readCompletionSchema(c: SqlClient): Promise<CompletionSchema> {
  const cells = cellsOf(c)
  switch (c.kind) {
    case 'postgresql': {
      const [[resetVal, user] = []] = await cells(PG_DEFAULT_SEARCH_PATH)
      return buildCompletionSchema({
        databases: firstCells(await cells(PG_DATABASES)),
        schemas: firstCells(await cells(PG_SCHEMAS)),
        columns: await cells(PG_COMPLETION_COLUMNS),
        functions: (await cells(PG_COMPLETION_FUNCTIONS)).map(pgFunctionOf),
        datatypes: await cells(PG_COMPLETION_TYPES),
        foreignKeys: await cells(PG_FOREIGN_KEYS),
        searchPath: pgDefaultSearchPath(resetVal ?? '', user ?? '')
      })
    }
    case 'mysql': {
      const databases = firstCells(await cells(MYSQL_DATABASES))
      const views = new Set(
        (await cells(MYSQL_ALL_DATABASES.views!)).map(([name, s]) => `${s}\0${name}`)
      )
      const columns = (await cells(MYSQL_COMPLETION_COLUMNS)).map(([s, name, ...rest]): Cells => [
        s,
        name,
        views.has(`${s}\0${name}`) ? '1' : '0',
        ...rest
      ])
      const routines = mysqlRoutinesOf(await cells(MYSQL_COMPLETION_ROUTINES))
      // 同 mycli：这几项读不出来（如无权读 mysql 库里的表）即没有这一项的候选，不影响其余的
      const optional = (sql: string): Promise<Cells[]> => cells(sql).catch(() => [])
      return {
        ...buildCompletionSchema({
          databases,
          schemas: databases,
          columns,
          functions: routines.functions,
          datatypes: [],
          procedures: routines.procedures,
          foreignKeys: await cells(MYSQL_FOREIGN_KEYS),
          searchPath: await readSearchPath(c)
        }),
        // mycli 取 SHOW CHARACTER SET、SHOW COLLATION 的第一列
        characterSets: firstCells(await optional('show character set')),
        collations: firstCells(await optional('show collation')),
        showItems: mysqlShowItemsOf(await optional(MYSQL_SHOW_ITEMS)),
        users: firstCells(await optional(MYSQL_COMPLETION_USERS))
      }
    }
    case 'sqlite':
      return buildCompletionSchema({
        databases: firstCells(await cells('select name from pragma_database_list')),
        schemas: ['main'],
        columns: await sqliteCompletionColumns(c),
        functions: [],
        datatypes: [],
        foreignKeys: sqliteForeignKeysOf(
          await cells(SQLITE_FOREIGN_KEYS),
          await cells(SQLITE_PRIMARY_KEYS)
        ),
        searchPath: ['main']
      })
  }
}

// —— 控制台上下文 ——

/**
 * 连接当前的控制台上下文（见 shared/data-source-context）：PostgreSQL 为所在的库、current_schema() 与 search_path，
 * MySQL / MariaDB 为 database()；SQLite 没有（null）。
 */
export async function readConsoleContext(c: SqlClient): Promise<ConsoleContext | null> {
  const cells = cellsOf(c)
  switch (c.kind) {
    case 'postgresql': {
      const [[database, schema, searchPath] = []] = await cells(
        "select current_database(), current_schema(), current_setting('search_path')"
      )
      return {
        kind: 'postgresql',
        database: database ?? '',
        schema: schema ?? null,
        searchPath: searchPath ?? ''
      }
    }
    case 'mysql': {
      const [[database = null] = []] = await cells('select database()')
      return { kind: 'mysql', database }
    }
    case 'sqlite':
      return null
  }
}

/** PostgreSQL：把连接的 search_path 设成 searchPath（会话级，同 SET search_path）；值作参数交给服务器，不拼进语句。 */
export async function setSearchPath(c: SqlClient, searchPath: string): Promise<void> {
  await runQuery(c, "select set_config('search_path', $1, false)", [searchPath])
}

/** MySQL / MariaDB：连接切到库 database（USE）。 */
export async function switchDatabase(c: SqlClient, database: string): Promise<void> {
  await runQuery(c, `use ${quoteIdent('mysql', database)}`)
}
