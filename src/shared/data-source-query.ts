// 查询结果与表数据的翻页（docs/prd/database.md「当前对象」「分页」「表格」）：结果一律是数据库给的原样文字，
// 二进制单独标出来；翻表时每页一条 LIMIT / OFFSET 查询，总行数另查。

import { coerce, lt } from 'semver'
import type { SqlKind } from './data-source'
import type { CatalogGroup } from './data-source-catalog'
import { searchPathItemName, searchPathItems, type ConsoleContext } from './data-source-context'

/** 一格的值：数据库给的原样文字；NULL 为 null；二进制为十六进制（不带前缀）。 */
export type ResultValue = string | null | { hex: string }

/** 列的大类：数字右对齐、导出 JSON 时写成数字；布尔导出成布尔；其余当文字。 */
export type ResultColumnType = 'number' | 'boolean' | 'text'

export interface ResultColumn {
  name: string
  type: ResultColumnType
}

export interface ResultSet {
  columns: ResultColumn[]
  rows: ResultValue[][]
}

/**
 * 查询的结果：结果集（限了行数时 truncated 表示后面还有），或没有结果集的语句影响的行数。
 */
export type QueryOutcome =
  ({ kind: 'rows'; truncated: boolean } & ResultSet) | { kind: 'affected'; count: number }

/** SQL 方言（MariaDB 按 MySQL 写）。 */
export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite'

export function dialectOf(kind: SqlKind): SqlDialect {
  return kind === 'mariadb' ? 'mysql' : kind
}

/** 目录里的一张表 / 视图：所在的库（MySQL）或库与模式（PostgreSQL），SQLite 只有名字。 */
export interface TableRef {
  database?: string
  schema?: string
  name: string
}

export function quoteIdent(dialect: SqlDialect, name: string): string {
  return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`
}

/** 带库或模式的完整表名：PostgreSQL 为 模式.表（连接本就在那个库上），MySQL 为 库.表，SQLite 只写表名。 */
export function qualifiedName(dialect: SqlDialect, table: TableRef): string {
  const qualifier =
    dialect === 'postgresql' ? table.schema : dialect === 'mysql' ? table.database : undefined
  const name = quoteIdent(dialect, table.name)
  return qualifier === undefined ? name : `${quoteIdent(dialect, qualifier)}.${name}`
}

/** 点表头的排序：某一列的升序或降序（表头显示箭头）。 */
export interface TableSort {
  column: string
  direction: 'asc' | 'desc'
}

/** 点表头生成的 ORDER BY 文字（不带关键字）：按方言引用列名，如 `"name" DESC`。 */
export function headerOrderBy(dialect: SqlDialect, sort: TableSort): string {
  return `${quoteIdent(dialect, sort.column)} ${sort.direction === 'asc' ? 'ASC' : 'DESC'}`
}

/** ORDER BY 文字恰好是点这些列中某一列表头的结果时为那一列与方向；手写的、改过的、空的为 null。 */
export function headerSortOf(
  dialect: SqlDialect,
  orderBy: string,
  columns: readonly string[]
): TableSort | null {
  for (const column of columns) {
    for (const direction of ['asc', 'desc'] as const) {
      if (headerOrderBy(dialect, { column, direction }) === orderBy) return { column, direction }
    }
  }
  return null
}

/** 点表头后的 ORDER BY 文字（不叠加）：别的排序 → 这列升序 → 降序 → 不排（空串）。 */
export function nextHeaderOrderBy(dialect: SqlDialect, orderBy: string, column: string): string {
  const sort = headerSortOf(dialect, orderBy, [column])
  if (sort === null) return headerOrderBy(dialect, { column, direction: 'asc' })
  return sort.direction === 'asc' ? headerOrderBy(dialect, { column, direction: 'desc' }) : ''
}

export interface TableSelectQuery {
  table: TableRef
  /** 用户输入的 WHERE 条件（原样拼进去，空串为不筛选） */
  where: string
  /** 用户输入的 ORDER BY 子句，不带关键字（原样拼进去，空串为只按主键排） */
  orderBy: string
  /** 主键的列：排在 ORDER BY 最后，排序列有重复值时翻页也不重不漏；没有主键就不加 */
  primaryKey: string[]
}

export interface TablePageQuery extends TableSelectQuery {
  page: number
  pageSize: number
}

/**
 * WHERE 子句：条件原样加上括号，条件之后先换行。末尾写了行注释（-- 或 MySQL 的 #）时，只注释掉它自己那一行，
 * 不吞掉右括号与后面拼上的子句。
 */
function whereClause(where: string): string {
  const condition = where.trim()
  return condition === '' ? '' : ` where (${condition}\n)`
}

/**
 * ORDER BY 子句：用户的文字原样拼进去，之后先换行（同 whereClause），再接主键列；末尾的行注释不吞掉主键与
 * LIMIT / OFFSET。
 */
function orderByClause(dialect: SqlDialect, orderBy: string, primaryKey: string[]): string {
  const order = orderBy.trim()
  const keys = primaryKey.map((column) => quoteIdent(dialect, column)).join(', ')
  if (order === '') return keys === '' ? '' : ` order by ${keys}`
  return ` order by ${order}\n${keys === '' ? '' : `, ${keys}`}`
}

/** 整张表（导出用）：SELECT * … [WHERE …] [ORDER BY …, 主键]。 */
export function tableSelectSql(dialect: SqlDialect, q: TableSelectQuery): string {
  const order = orderByClause(dialect, q.orderBy, q.primaryKey)
  return `select * from ${qualifiedName(dialect, q.table)}${whereClause(q.where)}${order}`
}

/** 一页数据：整张表的查询再加 LIMIT … OFFSET …。 */
export function tablePageSql(dialect: SqlDialect, q: TablePageQuery): string {
  return `${tableSelectSql(dialect, q)} limit ${q.pageSize} offset ${q.page * q.pageSize}`
}

/** 总行数（带同样的筛选）。 */
export function tableCountSql(dialect: SqlDialect, table: TableRef, where: string): string {
  return `select count(*) from ${qualifiedName(dialect, table)}${whereClause(where)}`
}

/** 表格里一格显示的文字：NULL 显示为 NULL；二进制显示长度与开头 16 个字节。 */
export function cellText(value: ResultValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return value
  const bytes = value.hex.length / 2
  const head = value.hex.slice(0, 32).toUpperCase()
  return `0x${head}${bytes > 16 ? '…' : ''}（${bytes} 字节）`
}

/** 每页行数的常用值、默认值与上限（不超过控制台最多取回的行数）。 */
export const PAGE_SIZE_PRESETS = [100, 200, 500, 1000] as const
export const DEFAULT_PAGE_SIZE = 500
export const MAX_PAGE_SIZE = 10_000

/** 合法的每页行数：1 到上限之间的整数。 */
export function isPageSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PAGE_SIZE
}

/** 控制台结果最多取回的行数（再多提示「只取回了前 1 万行」）。 */
export const CONSOLE_ROW_LIMIT = 10_000

// —— 当前对象（docs/prd/database.md「当前对象」）——

/** 翻表的一页：表、WHERE、ORDER BY 与页码（主键由主进程现查）。 */
export type TablePageRequest = Omit<TablePageQuery, 'primaryKey'>

/** 读取失败时交回的原因（数据库的原话）；账号无权读取时为 denied。 */
export type QueryFailure = { error: string } | { denied: true }

/** 失败的说明文字：数据库的原话；无权时为 denied（缺省「无权查看」，执行、取消各有说法）。 */
export function queryFailureText(failure: QueryFailure, denied = '无权查看'): string {
  return 'denied' in failure ? denied : failure.error
}

export type TablePageResult = { result: ResultSet } | QueryFailure

export type TableCountResult = { count: number } | QueryFailure | { canceled: true }

/** 表与视图以外的对象：能取到建它的语句的给定义，其余给一张信息表（如角色的权限、序列的参数）。 */
export type ObjectDetail = { definition: string } | { result: ResultSet } | QueryFailure

/** 看数据（翻页、排序、筛选）的对象分组；其余分组看定义或信息表。 */
export const DATA_GROUPS: ReadonlySet<CatalogGroup> = new Set<CatalogGroup>([
  'tables',
  'views',
  'matviews'
])

/**
 * MySQL / MariaDB 在 information_schema.columns 里认出生成列的条件（整表导出为 SQL INSERT 时不写生成列，见主进程的
 * generatedColumnsOf），按 select version() 的结果定，是不是 MariaDB 照 mycli 的 ServerInfo 看版本里有没有 -MariaDB。
 * generation_expression 在 MySQL 5.7.6、MariaDB 10.2.5 起才有（不是生成列时 MySQL 为空串、MariaDB 为 NULL）；之前的
 * MySQL 没有生成列（null），之前的 MariaDB 早有虚拟列，extra 标 VIRTUAL 或 PERSISTENT（10.2.5 起改标 VIRTUAL
 * GENERATED、STORED GENERATED）。读不出版本号的当旧版本，不查可能没有的列。
 */
export function mysqlGeneratedColumnCondition(version: string): string | null {
  const mariadb = version.includes('-MariaDB')
  const parsed = coerce(version)
  if (parsed === null || lt(parsed, mariadb ? '10.2.5' : '5.7.6')) {
    return mariadb ? `extra in ('VIRTUAL', 'PERSISTENT')` : null
  }
  return `generation_expression <> ''`
}

// —— 控制台（docs/prd/database.md「控制台」）——

/** 控制台里一条语句的执行结果。 */
export interface ConsoleStatementResult {
  sql: string
  /** 用时（毫秒） */
  ms: number
  outcome:
    | { kind: 'rows'; count: number; truncated: boolean }
    | { kind: 'affected'; count: number }
    | { kind: 'error'; message: string }
    | { kind: 'canceled' }
}

/** 一次执行：各条语句依次执行、遇错即停；表格显示最后一个结果集。 */
export interface ConsoleRun {
  statements: ConsoleStatementResult[]
  result: (ResultSet & { truncated: boolean }) | null
}

/** 一条语句的结果说明（结果区的语句列表与摘要共用）。 */
export function statementOutcomeText(result: ConsoleStatementResult): string {
  const { outcome } = result
  switch (outcome.kind) {
    case 'rows':
      return outcome.truncated ? `只取回了前 ${outcome.count} 行` : `${outcome.count} 行`
    case 'affected':
      return `影响 ${outcome.count} 行`
    case 'error':
      return outcome.message
    case 'canceled':
      return '已取消'
  }
}

/** 一次执行的摘要：一条为「结果 · 用时」，多条为「N 条语句 · 总用时」；没有语句为 null。 */
export function consoleRunSummary(run: ConsoleRun): string | null {
  const { statements } = run
  if (statements.length === 0) return null
  if (statements.length === 1) {
    return `${statementOutcomeText(statements[0]!)} · ${statements[0]!.ms} 毫秒`
  }
  return `${statements.length} 条语句 · ${statements.reduce((sum, s) => sum + s.ms, 0)} 毫秒`
}

/**
 * 一次执行在结果区显示什么：有语句出错时为出错的那条，不出结果集（居中报错）；否则为最后一个结果集，没有时为 null
 * （列出各条语句）。结果区与「导出已取回的结果」共用。
 */
export function consoleRunResult(run: ConsoleRun): {
  failed: ConsoleStatementResult | null
  result: ConsoleRun['result']
} {
  const failed = run.statements.find((s) => s.outcome.kind === 'error') ?? null
  return { failed, result: failed === null ? run.result : null }
}

// —— 补全（交给渲染端的补全引擎 lib/sql-completion，形状对应 pgcli 各 extend_* 的输入）——

/** 补全用的一列。 */
export interface CompletionColumn {
  name: string
  /** 列类型（MySQL / MariaDB 为 COLUMN_TYPE，枚举列的取值从中解析，如 enum('a','b')）；不知道为 null */
  datatype: string | null
  /** 默认值的表达式：INSERT 里展开 * 时跳过默认值为 now()、nextval(…) 的列；没有为 null */
  default?: string | null
  hasDefault?: boolean
}

/** 补全用的表或视图。 */
export interface CompletionRelation {
  name: string
  columns: CompletionColumn[]
}

/** 补全用的函数（pgcli 读 pg_proc 的各项；模式取所在的 CompletionNamespace）。 */
export interface CompletionFunction {
  funcName: string
  /** 各参数名（含出参）；没有为 null */
  argNames: readonly string[] | null
  /** 各参数类型，与 argNames 对应；取不到为 null */
  argTypes: readonly string[] | null
  /** 各参数的模式（pg_proc.proargmodes：i 入、o 出、b 入出、v 可变、t 表）；全是入参时为 null */
  argModes: readonly string[] | null
  returnType: string
  isAggregate: boolean
  isWindow: boolean
  /** 返回结果集（FROM 里可作表用，列取出参） */
  isSetReturning: boolean
  /** 扩展带来的（不补全） */
  isExtension: boolean
  /** 入参的默认值（pg_get_expr(proargdefaults)，逗号分隔，对应最后几个入参）；没有为 null */
  argDefaults: string | null
}

/** 补全用的一个模式里的对象（MySQL / MariaDB 为一个库；SQLite 为 main 或附加的库）。 */
export interface CompletionNamespace {
  name: string
  tables: CompletionRelation[]
  views: CompletionRelation[]
  functions: CompletionFunction[]
  /** 自定义类型（PostgreSQL） */
  datatypes: string[]
  /** 存储过程（MySQL / MariaDB：CALL 之后补全） */
  procedures?: string[]
}

/** 外键的一列：子表的列引用父表的列（JOIN 之后按它补连接的表，ON 之后补连接条件）。 */
export interface CompletionForeignKey {
  parentschema: string
  parenttable: string
  parentcolumn: string
  childschema: string
  childtable: string
  childcolumn: string
}

/**
 * 补全用的表结构：PostgreSQL 为连接所在的一个库；MySQL / MariaDB 为全部库；SQLite 为这个文件。
 */
export interface CompletionSchema {
  /** 库（USE、DROP DATABASE 等之后补全） */
  databases: string[]
  schemas: CompletionNamespace[]
  /**
   * 不写前缀时查找的模式或库：PostgreSQL 为实际的查找次序（current_schemas(true)，含隐含的 pg_catalog），MySQL /
   * MariaDB 为读它的那条连接所在的库（database()，没选为空），SQLite 为 main。控制台里随控制台上下文，见 consoleSearchPath
   */
  searchPath: string[]
  foreignKeys: CompletionForeignKey[]
  // 以下为 MySQL / MariaDB（mycli），不给时这些位置没有候选：
  /** 字符集（CHARACTER SET、CONVERT … USING 之后，与字符集引导符 _utf8mb4） */
  characterSets?: string[]
  /** 排序规则（COLLATE 之后） */
  collations?: string[]
  /** SHOW 之后的项目 */
  showItems?: string[]
  /** 用户（'user'@'host'） */
  users?: string[]
}

/**
 * 补全的使用次数（pgcli 的 PrevalenceCounter）：执行成功的语句里各关键字与各名字出现了几次，补全时用得多的排前。按数据源
 * 记、跨重启保存，移除数据源时删掉。
 */
export interface CompletionUsage {
  keywords: Record<string, number>
  names: Record<string, number>
}

/** 登记的数据源执行成功了这些 SQL 语句（控制台与运行配置）：交给补全计数（见 CompletionUsage）。 */
export interface DataSourceExecutedEvent {
  dataSourceId: string
  /** 执行时数据源的类型（关键字表与切词按它） */
  kind: SqlKind
  statements: string[]
}

/**
 * 控制台上下文对应的 searchPath（见 CompletionSchema.searchPath；USE、SET search_path 之后不必重读整份补全）：
 * PostgreSQL 同 current_schemas(true)——没写 pg_catalog 时它隐含在最前，其后是 current_schema() 与 search_path 里的
 * 其余各项（"$user" 不另解析：它对得上且排在最前时即 current_schema()；对不上的项补全时自然查不到，不必去掉）；MySQL /
 * MariaDB 为控制台所在的库（没选为空）；Redis 没有，为空。
 */
export function consoleSearchPath(context: ConsoleContext): string[] {
  switch (context.kind) {
    case 'postgresql': {
      const items = searchPathItems(context.searchPath)
        .map(searchPathItemName)
        .filter((name) => name !== '$user')
      const path = [...new Set([...(context.schema === null ? [] : [context.schema]), ...items])]
      return path.includes('pg_catalog') ? path : ['pg_catalog', ...path]
    }
    case 'mysql':
      return context.database === null ? [] : [context.database]
    case 'redis':
      return []
  }
}

/** 去掉语句开头的空白与注释（按第一个关键字判断语句类别用）。 */
function stripLeadingComments(sql: string): string {
  return sql.replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)*/, '')
}

const SCHEMA_CHANGE = /^(create|alter|drop|rename|truncate|comment|grant|revoke)\b/i

/** 改结构的语句（执行后目录与补全要重读）：去掉开头的注释后，按第一个关键字判断。 */
export function isSchemaChange(sql: string): boolean {
  return SCHEMA_CHANGE.test(stripLeadingComments(sql))
}

const TRANSACTION_END = /^(commit|end|abort|rollback(?!(\s+(work|transaction))?\s+to\b))\b/i

/**
 * 结束事务的语句，执行后目录与补全同样要重读：事务里改的结构提交了，在后台临时连接上重读才看得到；回滚了，已按会话连接
 * 读到的也要撤掉。认 COMMIT、END、ROLLBACK 与 PostgreSQL 的 ABORT；回滚到保存点（ROLLBACK … TO）与释放保存点（RELEASE）
 * 不结束事务，不算。同 isSchemaChange 按去掉开头注释后的第一个关键字判断。
 * SQLite 重读前要重开文件，但事务还开着时（如事务里执行了改结构的语句）主进程不重开、只重读，免得把事务悄悄回滚；等这类
 * 语句触发的那次重读，事务已结束，才重开（见 main 的 reopenDataSourceSession）。
 */
export function isTransactionEnd(sql: string): boolean {
  return TRANSACTION_END.test(stripLeadingComments(sql))
}

const PG_CONTEXT_CHANGE =
  /^(set\s+((session|local)\s+)?(search_path|schema|role|session\s+authorization)\b|reset\s+(search_path|all|role|session\s+authorization)\b|discard\s+all\b)/i
const MYSQL_CONTEXT_CHANGE = /^(use|drop\s+(database|schema))\b/i

/**
 * 执行后要回查控制台上下文的语句（见 data-source-context）。PostgreSQL：改 search_path 的（SET [SESSION | LOCAL]
 * search_path、SET SCHEMA、RESET search_path、RESET ALL、DISCARD ALL）；换角色的（SET ROLE、SET SESSION AUTHORIZATION
 * 与对应的 RESET——默认的 search_path 里有 "$user"，current_schema() 随角色变）；改结构的（见 isSchemaChange：建、删、
 * 改名 search_path 里的模式，或授予、收回它的使用权，current_schema() 都会变）；结束事务的（事务里的 SET 随回滚撤销，
 * SET LOCAL 随事务结束失效）。MySQL / MariaDB：USE，与删库的 DROP DATABASE / SCHEMA（删的是控制台所在的库时 database()
 * 变为 NULL）。同 isSchemaChange 按去掉开头注释后的第一个关键字判断。SQLite 没有。
 */
export function changesConsoleContext(dialect: SqlDialect, sql: string): boolean {
  const statement = stripLeadingComments(sql)
  switch (dialect) {
    case 'postgresql':
      return (
        PG_CONTEXT_CHANGE.test(statement) ||
        isSchemaChange(statement) ||
        isTransactionEnd(statement)
      )
    case 'mysql':
      return MYSQL_CONTEXT_CHANGE.test(statement)
    case 'sqlite':
      return false
  }
}

// —— 导出（docs/prd/database.md「导出」）——

/** 导出整张表：带当前的 WHERE 与 ORDER BY，不只是当前页（主键由主进程现查）。 */
export type TableExportRequest = Omit<TableSelectQuery, 'primaryKey'>

/** 导出的结果：写到的文件，或失败原因（在保存对话框里取消的，渲染端不发起导出）。 */
export type ExportResult = { path: string } | QueryFailure
