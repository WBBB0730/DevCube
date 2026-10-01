// 当前对象的查询（docs/prd/database.md「当前对象」「导出」）：翻表时要的主键、整表导出为 SQL INSERT 时要的生成列与
// 总是自动生成的标识列，以及表与视图以外对象的定义或信息表。PostgreSQL 的连接须已连在对象所在的库上。

import type { CatalogPath } from '../shared/data-source-catalog'
import {
  mysqlGeneratedColumnCondition,
  qualifiedName,
  type ObjectDetail,
  type ResultSet,
  type SqlDialect,
  type TableRef
} from '../shared/data-source-query'
import { resultOf, runQuery, type SqlClient } from './data-source-connect'

/** 第一行名为 column 的那一格（取不到为 null）。 */
function cellOf(result: ResultSet, column: string): string | null {
  const index = result.columns.findIndex((c) => c.name.toLowerCase() === column.toLowerCase())
  const value = index < 0 ? undefined : result.rows[0]?.[index]
  return typeof value === 'string' ? value : null
}

/** 按表查出的列名（查询的第一列）：参数 PostgreSQL 为模式与表名，MySQL 为库与表名，SQLite 为表名。 */
async function tableColumnsOf(
  c: SqlClient,
  dialect: SqlDialect,
  table: TableRef,
  sql: string
): Promise<string[]> {
  const params =
    dialect === 'postgresql'
      ? [table.schema, table.name]
      : dialect === 'mysql'
        ? [table.database, table.name]
        : [table.name]
  const result = resultOf(await runQuery(c, sql, params))
  return result.rows.map((row) => String(row[0]))
}

/** 主键的列（按主键里的顺序）；视图、没有主键的表为空。 */
export function primaryKeyOf(
  c: SqlClient,
  dialect: SqlDialect,
  table: TableRef
): Promise<string[]> {
  return tableColumnsOf(
    c,
    dialect,
    table,
    dialect === 'postgresql'
      ? `select a.attname as name from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey) where i.indisprimary and n.nspname = $1 and c.relname = $2 order by array_position(i.indkey::int2[], a.attnum)`
      : dialect === 'mysql'
        ? `select column_name as name from information_schema.key_column_usage where table_schema = ? and table_name = ? and constraint_name = 'PRIMARY' order by ordinal_position`
        : `select name from pragma_table_info(?) where pk > 0 order by pk`
  )
}

/** PostgreSQL 服务器的版本号（server_version_num，如 170002）：按版本决定查不查旧版本没有的系统表列。 */
async function pgVersionNum(c: SqlClient): Promise<number> {
  const version = resultOf(await runQuery(c, 'show server_version_num'))
  return Number(cellOf(version, 'server_version_num'))
}

/**
 * 生成列（按列的次序）：值由数据库算出、插入时不能给，整表导出为 SQL INSERT 时不写（见 InsertTarget）；视图、没有
 * 生成列的表为空。服务器类的先看版本，不查旧版本没有的列。PostgreSQL 看 pg_attribute.attgenerated（存储的为 s，18
 * 起另有虚拟的 v）：这一列与生成列都是 12 起才有，之前的版本没有生成列。MySQL / MariaDB 看 information_schema.columns
 * 的 generation_expression，旧版本见 mysqlGeneratedColumnCondition；新版本不看 extra：MySQL 用表达式作默认值的列也标
 * DEFAULT_GENERATED，生成列又是隐藏列时两者的写法也不同。SQLite 看 pragma_table_xinfo 的 hidden（2 为虚拟、3 为存储
 * 的生成列）。
 */
export async function generatedColumnsOf(
  c: SqlClient,
  dialect: SqlDialect,
  table: TableRef
): Promise<string[]> {
  switch (dialect) {
    case 'postgresql': {
      if ((await pgVersionNum(c)) < 120000) return []
      return tableColumnsOf(
        c,
        dialect,
        table,
        `select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '' order by a.attnum`
      )
    }
    case 'mysql': {
      const version = resultOf(await runQuery(c, 'select version() as version'))
      const condition = mysqlGeneratedColumnCondition(cellOf(version, 'version') ?? '')
      if (condition === null) return []
      return tableColumnsOf(
        c,
        dialect,
        table,
        `select column_name as name from information_schema.columns where table_schema = ? and table_name = ? and ${condition} order by ordinal_position`
      )
    }
    case 'sqlite':
      return tableColumnsOf(
        c,
        dialect,
        table,
        `select name from pragma_table_xinfo(?) where hidden in (2, 3) order by cid`
      )
  }
}

/**
 * 总是自动生成的标识列（PostgreSQL 的 GENERATED ALWAYS AS IDENTITY，按列的次序）：给它写值的 INSERT 要加 OVERRIDING
 * SYSTEM VALUE，整表导出为 SQL INSERT 时据此加上、保留原来的值（见 InsertTarget）。看 pg_attribute.attidentity 为 a 的
 * 列（d 为 BY DEFAULT，本来就能写值）；标识列与这一列都是 10 起才有，之前的版本没有。其余数据库没有这种列：MySQL /
 * MariaDB 的 AUTO_INCREMENT、SQLite 的自增主键都能直接写值。
 */
export async function alwaysIdentityColumnsOf(
  c: SqlClient,
  dialect: SqlDialect,
  table: TableRef
): Promise<string[]> {
  if (dialect !== 'postgresql' || (await pgVersionNum(c)) < 100000) return []
  return tableColumnsOf(
    c,
    dialect,
    table,
    `select a.attname as name from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped and a.attidentity = 'a' order by a.attnum`
  )
}

/** 一条语句的定义：取第一行的 column 列，补上结尾的分号。取不到（没有这一行、这一格为 NULL）时为 missing。 */
async function definitionOf(
  c: SqlClient,
  sql: string,
  params: unknown[],
  column: string,
  missing: ObjectDetail = { error: '取不到这个对象的定义' }
): Promise<ObjectDetail> {
  const text = cellOf(resultOf(await runQuery(c, sql, params)), column)
  if (text === null) return missing
  return { definition: /;\s*$/.test(text) ? text : `${text.trimEnd()};` }
}

/** 对象的信息表：查询的结果集。 */
async function infoTableOf(c: SqlClient, sql: string, params: unknown[]): Promise<ObjectDetail> {
  return { result: resultOf(await runQuery(c, sql, params)) }
}

async function pgDetail(
  c: SqlClient,
  path: CatalogPath,
  name: string,
  detail?: string
): Promise<ObjectDetail> {
  switch (path.group) {
    case 'functions':
    case 'procedures':
      return definitionOf(
        c,
        `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2 and pg_get_function_identity_arguments(p.oid) = $3`,
        [path.schema, name, detail ?? ''],
        'def'
      )
    case 'triggers':
      return definitionOf(
        c,
        `select pg_get_triggerdef(tg.oid, true) as def from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and tg.tgname = $2 and c.relname = $3`,
        [path.schema, name, detail ?? ''],
        'def'
      )
    case 'sequences':
      return infoTableOf(
        c,
        `select * from pg_sequences where schemaname = $1 and sequencename = $2`,
        [path.schema, name]
      )
    case 'types':
      return infoTableOf(
        c,
        `select t.typname as name, t.typtype as kind, format_type(t.typbasetype, t.typtypmod) as base, (select string_agg(e.enumlabel, ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as labels, (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) as attributes from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = $1 and t.typname = $2`,
        [path.schema, name]
      )
    case 'extensions':
      return infoTableOf(
        c,
        `select e.extname as name, e.extversion as version, n.nspname as schema, obj_description(e.oid, 'pg_extension') as description from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = $1`,
        [name]
      )
    case 'roles':
      return infoTableOf(
        c,
        `select r.rolname as name, r.rolsuper as superuser, r.rolinherit as inherit, r.rolcreaterole as create_role, r.rolcreatedb as create_db, r.rolcanlogin as can_login, r.rolreplication as replication, r.rolbypassrls as bypass_rls, r.rolconnlimit as connection_limit, r.rolvaliduntil as valid_until, array(select b.rolname from pg_auth_members m join pg_roles b on b.oid = m.roleid where m.member = r.oid order by 1) as member_of from pg_roles r where r.rolname = $1`,
        [name]
      )
    default:
      return { error: '没有可显示的内容' }
  }
}

/** MySQL 的 SHOW CREATE：对象按 库.名 写，定义在结果的某一列。 */
const MYSQL_SHOW_CREATE: Partial<Record<NonNullable<CatalogPath['group']>, [string, string]>> = {
  procedures: ['procedure', 'Create Procedure'],
  functions: ['function', 'Create Function'],
  triggers: ['trigger', 'SQL Original Statement'],
  events: ['event', 'Create Event']
}

async function mysqlDetail(
  c: SqlClient,
  path: CatalogPath,
  name: string,
  detail?: string
): Promise<ObjectDetail> {
  if (path.group === 'users') {
    // 用户的权限：SHOW GRANTS 每行一条授权语句
    const result = resultOf(await runQuery(c, 'show grants for ?@?', [name, detail ?? '%']))
    return { definition: result.rows.map((row) => `${String(row[0])};`).join('\n') }
  }
  const show = path.group === undefined ? undefined : MYSQL_SHOW_CREATE[path.group]
  if (show === undefined) return { error: '没有可显示的内容' }
  const [keyword, column] = show
  const table = qualifiedName('mysql', { database: path.database, name })
  // 存储过程与函数的正文，不是它的定义者时要有 SHOW_ROUTINE（MySQL 8.0.20 起）或全局 SELECT 权限：没有时服务器
  // 不报错，只把定义这一格返回为 NULL（库级的全部权限不包含它），所以 NULL 即无权查看
  return definitionOf(c, `show create ${keyword} ${table}`, [], column, { denied: true })
}

async function sqliteDetail(c: SqlClient, path: CatalogPath, name: string): Promise<ObjectDetail> {
  const type = path.group === 'indexes' ? 'index' : path.group === 'triggers' ? 'trigger' : null
  if (type === null) return { error: '没有可显示的内容' }
  return definitionOf(
    c,
    `select sql from sqlite_schema where type = ? and name = ?`,
    [type, name],
    'sql'
  )
}

/** 表与视图以外对象的定义或信息表。 */
export function objectDetailOf(
  c: SqlClient,
  dialect: SqlDialect,
  path: CatalogPath,
  name: string,
  detail?: string
): Promise<ObjectDetail> {
  switch (dialect) {
    case 'postgresql':
      return pgDetail(c, path, name, detail)
    case 'mysql':
      return mysqlDetail(c, path, name, detail)
    case 'sqlite':
      return sqliteDetail(c, path, name)
  }
}
