// 控制台上下文（docs/prd/database.md「控制台上下文」、ADR-0046）：Data Source Tab 的控制台在哪个库上执行——PostgreSQL 为库与
// search_path（其中第一个存在的模式即不写前缀时用的模式），MySQL / MariaDB 为控制台所在的库，Redis 为库编号（键列表也列
// 这个库的键）。
// 以服务器实际状态为准：主进程在切换后、执行了改它的语句后回查并推送给界面；按 Tab 记住，重连、重启后重新应用。

import type { DataSourceKind } from './data-source'
import type { CatalogPath } from './data-source-catalog'
import type { QueryFailure } from './data-source-query'

/** 控制台上下文（服务器上的实际状态）。MySQL 与 MariaDB 同为 mysql。 */
export type ConsoleContext =
  | {
      kind: 'postgresql'
      /** 控制台所在的库（current_database()） */
      database: string
      /** current_schema()：search_path 里第一个存在的模式；都不存在为 null */
      schema: string | null
      /** 原样的 search_path（如 `"$user", public`） */
      searchPath: string
    }
  | {
      kind: 'mysql'
      /** database()：没有选库为 null */
      database: string | null
    }
  | { kind: 'redis'; database: number }

export interface ConsoleContextEvent {
  tabKey: string
  context: ConsoleContext | null
}

/** 界面上的切换：PostgreSQL 切库并可选一个模式（放到 search_path 最前），MySQL / MariaDB 切库，Redis 切库编号。 */
export type ConsoleContextChange =
  | { kind: 'postgresql'; database: string; schema?: string }
  | { kind: 'mysql'; database: string }
  | { kind: 'redis'; database: number }

/** 按 Tab 记住的控制台上下文（跨重启；重连后重新应用）。 */
export type SavedConsoleContext =
  | { kind: 'postgresql'; database: string; searchPath: string }
  | { kind: 'mysql'; database: string }
  | { kind: 'redis'; database: number }

/** 数据源类型对应的上下文类别；SQLite 没有控制台上下文，为 null。 */
export function consoleContextKind(kind: DataSourceKind): ConsoleContext['kind'] | null {
  switch (kind) {
    case 'postgresql':
      return 'postgresql'
    case 'mysql':
    case 'mariadb':
      return 'mysql'
    case 'redis':
      return 'redis'
    case 'sqlite':
      return null
  }
}

/** 要记住的那部分；MySQL / MariaDB 没有选库时没有要记的，为 null。 */
export function savedConsoleContext(context: ConsoleContext): SavedConsoleContext | null {
  switch (context.kind) {
    case 'postgresql':
      return {
        kind: 'postgresql',
        database: context.database,
        searchPath: context.searchPath
      }
    case 'mysql':
      return context.database === null ? null : { kind: 'mysql', database: context.database }
    case 'redis':
      return { kind: 'redis', database: context.database }
  }
}

/**
 * 切换是否就是现在所在的（点了当前那一项，不用再执行）：库相同，PostgreSQL 没选模式或选的就是 current_schema()。
 */
export function isCurrentConsoleContext(
  context: ConsoleContext,
  change: ConsoleContextChange
): boolean {
  if (context.kind !== change.kind || context.database !== change.database) return false
  return (
    change.kind !== 'postgresql' ||
    context.kind !== 'postgresql' ||
    change.schema === undefined ||
    change.schema === context.schema
  )
}

/** 控制台上下文的一级：库或模式（SQL 控制台工具栏的「库」「模式」各管一级，Redis 的库编号为库）。 */
export type ConsoleContextLevel = 'database' | 'schema'

/**
 * 切换要变的各级（切换中这几级的钮转圈）：PostgreSQL 带了模式时模式要变，要切到的库不是 context（现在的控制台上下文）
 * 所在的库时库也要变——跨库切模式（目录右键别的库里的模式）两级都变；其余只有库要变。
 */
export function consoleContextChangeLevels(
  context: ConsoleContext | null | undefined,
  change: ConsoleContextChange
): ConsoleContextLevel[] {
  if (change.kind !== 'postgresql' || change.schema === undefined) return ['database']
  return context?.kind === 'postgresql' && context.database === change.database
    ? ['schema']
    : ['database', 'schema']
}

/**
 * 切换控制台上下文切不过去：原因（同 QueryFailure）；出错在改 search_path 那一步（PostgreSQL 切模式，库已连上）的
 * 另记 searchPath。
 */
export type ConsoleContextFailure = QueryFailure & { searchPath?: true }

/**
 * 切不过去时没切过去的那一级（错误框的标题按它）：出错在改 search_path 那一步为模式；在那之前（连那个库、USE、SELECT，
 * 或还没开始）为要变的第一级——库要变时为库，同库切模式为模式。
 */
export function consoleContextFailureLevel(
  context: ConsoleContext | null | undefined,
  change: ConsoleContextChange,
  failure: ConsoleContextFailure
): ConsoleContextLevel {
  return failure.searchPath !== true &&
    consoleContextChangeLevels(context, change).includes('database')
    ? 'database'
    : 'schema'
}

/**
 * 目录里一行「在控制台中打开」要切到的；path 为这一行在目录里的位置（库行、模式行为进入它之后的位置，见 childPath）。
 * PostgreSQL 在某个模式里（模式行及其下的分组、对象）为那个库并把模式放到 search_path 最前，只在某个库里（库行及库下
 * 不属于某个模式的，如扩展）只换库；MySQL / MariaDB 在某个库里（库行及其下的行）换库。不在某个库里（根行，PostgreSQL
 * 的角色、MySQL / MariaDB 的用户）为 null，不换。
 */
export function catalogConsoleContextChange(
  kind: ConsoleContext['kind'],
  path: CatalogPath
): ConsoleContextChange | null {
  const { database, schema } = path
  if (database === undefined) return null
  switch (kind) {
    case 'postgresql':
      return schema === undefined ? { kind, database } : { kind, database, schema }
    case 'mysql':
      return { kind, database }
    case 'redis':
      return null
  }
}

/** Redis 库编号的写法（同 INFO keyspace）：db0、db1…… */
export function redisDatabaseLabel(database: number): string {
  return `db${database}`
}

// —— PostgreSQL 的 search_path ——

/** search_path 拆成各项（原样，带引号的保留引号）：按不在双引号里的逗号切开，去掉首尾空白，空项不要。 */
export function searchPathItems(searchPath: string): string[] {
  const items: string[] = []
  let item = ''
  let quoted = false
  for (const ch of searchPath) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      items.push(item)
      item = ''
    } else {
      item += ch
    }
  }
  items.push(item)
  return items.map((i) => i.trim()).filter((i) => i !== '')
}

/**
 * 一项对应的模式名：双引号括起的去掉引号、把 `""` 还原成 `"`；不带引号的按 PostgreSQL 的规则把 ASCII 大写字母折成小写。
 */
export function searchPathItemName(item: string): string {
  if (item.length >= 2 && item.startsWith('"') && item.endsWith('"')) {
    return item.slice(1, -1).replace(/""/g, '"')
  }
  return item.replace(/[A-Z]/g, (ch) => ch.toLowerCase())
}

/** 选了模式 schema：它放到 search_path 最前（加双引号），原有各项原样跟在后面，去掉与它同名的那一项。 */
export function prependSearchPath(searchPath: string, schema: string): string {
  const rest = searchPathItems(searchPath).filter((item) => searchPathItemName(item) !== schema)
  return [`"${schema.replace(/"/g, '""')}"`, ...rest].join(', ')
}
