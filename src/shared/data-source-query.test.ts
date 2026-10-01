import { describe, expect, it } from 'vitest'
import {
  cellText,
  changesConsoleContext,
  consoleRunResult,
  consoleRunSummary,
  consoleSearchPath,
  dialectOf,
  headerOrderBy,
  headerSortOf,
  isSchemaChange,
  isTransactionEnd,
  mysqlGeneratedColumnCondition,
  nextHeaderOrderBy,
  qualifiedName,
  quoteIdent,
  statementOutcomeText,
  tableCountSql,
  tablePageSql,
  tableSelectSql,
  type ConsoleStatementResult,
  type TablePageQuery
} from './data-source-query'

describe('quoteIdent / qualifiedName', () => {
  it('按方言引用，内部引号加倍', () => {
    expect(quoteIdent('postgresql', 'order "x"')).toBe('"order ""x"""')
    expect(quoteIdent('mysql', 'a`b')).toBe('`a``b`')
  })

  it('PostgreSQL 为 模式.表，MySQL 为 库.表，SQLite 只写表名', () => {
    const table = { database: 'shop', schema: 'public', name: 'users' }
    expect(qualifiedName('postgresql', table)).toBe('"public"."users"')
    expect(qualifiedName('mysql', table)).toBe('`shop`.`users`')
    expect(qualifiedName('sqlite', { name: 'users' })).toBe('"users"')
  })

  it('MariaDB 按 MySQL 写', () => {
    expect(dialectOf('mariadb')).toBe('mysql')
  })
})

describe('headerOrderBy / headerSortOf / nextHeaderOrderBy', () => {
  it('按方言引用列名，方向写成 ASC / DESC', () => {
    expect(headerOrderBy('postgresql', { column: 'name', direction: 'desc' })).toBe('"name" DESC')
    expect(headerOrderBy('sqlite', { column: 'a"b', direction: 'asc' })).toBe('"a""b" ASC')
    expect(headerOrderBy('mysql', { column: 'name', direction: 'asc' })).toBe('`name` ASC')
  })

  it('文字恰好是点某列表头的结果才认出那列；手写的、改过的、空的认不出', () => {
    const columns = ['id', 'name']
    expect(headerSortOf('postgresql', '"name" DESC', columns)).toEqual({
      column: 'name',
      direction: 'desc'
    })
    expect(headerSortOf('mysql', '`id` ASC', columns)).toEqual({ column: 'id', direction: 'asc' })
    expect(headerSortOf('postgresql', '"name" desc', columns)).toBeNull()
    expect(headerSortOf('postgresql', 'name DESC', columns)).toBeNull()
    expect(headerSortOf('postgresql', '"name" DESC, "id"', columns)).toBeNull()
    expect(headerSortOf('postgresql', '"other" ASC', columns)).toBeNull()
    expect(headerSortOf('mysql', '"name" DESC', columns)).toBeNull()
    expect(headerSortOf('postgresql', '', columns)).toBeNull()
  })

  it('点表头不叠加：别的排序 → 升序 → 降序 → 不排', () => {
    expect(nextHeaderOrderBy('postgresql', '', 'name')).toBe('"name" ASC')
    expect(nextHeaderOrderBy('postgresql', '"name" ASC', 'name')).toBe('"name" DESC')
    expect(nextHeaderOrderBy('postgresql', '"name" DESC', 'name')).toBe('')
    expect(nextHeaderOrderBy('postgresql', '"id" DESC', 'name')).toBe('"name" ASC')
    expect(nextHeaderOrderBy('mysql', 'created_at desc, id', 'name')).toBe('`name` ASC')
  })
})

describe('tableSelectSql / tablePageSql / tableCountSql', () => {
  const base: TablePageQuery = {
    table: { schema: 'public', name: 'users' },
    where: '',
    orderBy: '',
    primaryKey: ['id'],
    page: 2,
    pageSize: 100
  }

  it('ORDER BY 为空时按主键排；页码换算成 OFFSET', () => {
    expect(tablePageSql('postgresql', base)).toBe(
      'select * from "public"."users" order by "id" limit 100 offset 200'
    )
  })

  it('WHERE 与 ORDER BY 原样拼进去（之后换行），主键排在最后', () => {
    expect(
      tablePageSql('postgresql', {
        ...base,
        where: ' age > 18 ',
        orderBy: ' created_at DESC, name '
      })
    ).toBe(
      'select * from "public"."users" where (age > 18\n) order by created_at DESC, name\n, "id" limit 100 offset 200'
    )
  })

  it('用户文字末尾的行注释只注释掉它自己那一行：括号、主键与 LIMIT / OFFSET 照常生效', () => {
    const commented = { where: 'age > 18 -- 成年', orderBy: 'name -- 按名字' }
    expect(tablePageSql('postgresql', { ...base, ...commented })).toBe(
      'select * from "public"."users" where (age > 18 -- 成年\n) order by name -- 按名字\n, "id" limit 100 offset 200'
    )
    expect(
      tablePageSql('mysql', {
        ...base,
        table: { database: 'shop', name: 'users' },
        where: 'age > 18 # 成年',
        orderBy: 'name -- 按名字'
      })
    ).toBe(
      'select * from `shop`.`users` where (age > 18 # 成年\n) order by name -- 按名字\n, `id` limit 100 offset 200'
    )
    // 没有主键时，LIMIT 也在注释的下一行
    expect(
      tablePageSql('sqlite', { ...base, ...commented, table: { name: 'v' }, primaryKey: [] })
    ).toBe(
      'select * from "v" where (age > 18 -- 成年\n) order by name -- 按名字\n limit 100 offset 200'
    )
    expect(tableCountSql('sqlite', { name: 'v' }, commented.where)).toBe(
      'select count(*) from "v" where (age > 18 -- 成年\n)'
    )
  })

  it('主键按方言引用、按主键里的顺序排在最后', () => {
    expect(
      tableSelectSql('mysql', {
        table: { database: 'shop', name: 'orders' },
        where: '',
        orderBy: '`total` DESC',
        primaryKey: ['shop_id', 'order_id']
      })
    ).toBe('select * from `shop`.`orders` order by `total` DESC\n, `shop_id`, `order_id`')
    expect(
      tableSelectSql('sqlite', {
        table: { name: 'events' },
        where: '',
        orderBy: '',
        primaryKey: ['a"b']
      })
    ).toBe('select * from "events" order by "a""b"')
  })

  it('没有主键时不追加；ORDER BY 也为空就不排', () => {
    const view = { ...base, table: { name: 'v' }, primaryKey: [], page: 0 }
    expect(tablePageSql('sqlite', { ...view, orderBy: 'name' })).toBe(
      'select * from "v" order by name\n limit 100 offset 0'
    )
    expect(tablePageSql('sqlite', { ...view, orderBy: '  ' })).toBe(
      'select * from "v" limit 100 offset 0'
    )
  })

  it('总行数带同样的筛选', () => {
    expect(tableCountSql('mysql', { database: 'shop', name: 'users' }, 'age > 18')).toBe(
      'select count(*) from `shop`.`users` where (age > 18\n)'
    )
    expect(tableCountSql('mysql', { database: 'shop', name: 'users' }, ' ')).toBe(
      'select count(*) from `shop`.`users`'
    )
  })
})

describe('cellText', () => {
  it('NULL 与空字符串分得清；二进制显示开头与长度', () => {
    expect(cellText(null)).toBe('NULL')
    expect(cellText('')).toBe('')
    expect(cellText({ hex: 'deadbeef' })).toBe('0xDEADBEEF（4 字节）')
    expect(cellText({ hex: '00'.repeat(20) })).toBe(`0x${'00'.repeat(16)}…（20 字节）`)
  })
})

describe('mysqlGeneratedColumnCondition', () => {
  const expression = `generation_expression <> ''`
  const extra = `extra in ('VIRTUAL', 'PERSISTENT')`

  it('MySQL 5.7.6 起看 generation_expression，之前的版本没有生成列', () => {
    expect(mysqlGeneratedColumnCondition('8.4.11')).toBe(expression)
    expect(mysqlGeneratedColumnCondition('5.7.6-log')).toBe(expression)
    expect(mysqlGeneratedColumnCondition('5.7.5-m15')).toBeNull()
    expect(mysqlGeneratedColumnCondition('5.6.51-log')).toBeNull()
  })

  it('MariaDB 10.2.5 起看 generation_expression，之前的版本看 extra', () => {
    expect(mysqlGeneratedColumnCondition('11.4.13-MariaDB-ubu2404')).toBe(expression)
    expect(mysqlGeneratedColumnCondition('10.2.5-MariaDB')).toBe(expression)
    expect(mysqlGeneratedColumnCondition('10.2.4-MariaDB')).toBe(extra)
    expect(mysqlGeneratedColumnCondition('10.1.48-MariaDB-0+deb9u2')).toBe(extra)
    expect(mysqlGeneratedColumnCondition('5.5.68-MariaDB')).toBe(extra)
  })

  it('其他兼容 MySQL 的按开头的版本号；读不出版本号的当旧版本', () => {
    expect(mysqlGeneratedColumnCondition('8.0.11-TiDB-v7.5.0')).toBe(expression)
    expect(mysqlGeneratedColumnCondition('')).toBeNull()
  })
})

describe('isSchemaChange', () => {
  it('按第一个关键字判断，大小写不敏感，跳过开头的注释', () => {
    expect(isSchemaChange('CREATE TABLE t (id int)')).toBe(true)
    expect(isSchemaChange('  -- 加一列\n alter table t add c int')).toBe(true)
    expect(isSchemaChange('/* 清理 */ drop view v')).toBe(true)
    expect(isSchemaChange('select * from created')).toBe(false)
    expect(isSchemaChange('update t set a = 1')).toBe(false)
    expect(isSchemaChange('dropped')).toBe(false)
  })
})

describe('isTransactionEnd', () => {
  it('提交：COMMIT 与 END 的各种写法（含两阶段提交），跳过开头的注释', () => {
    expect(isTransactionEnd('COMMIT')).toBe(true)
    expect(isTransactionEnd('commit work')).toBe(true)
    expect(isTransactionEnd('COMMIT AND CHAIN')).toBe(true)
    expect(isTransactionEnd("COMMIT PREPARED 'tx1'")).toBe(true)
    expect(isTransactionEnd('END')).toBe(true)
    expect(isTransactionEnd('end transaction')).toBe(true)
    expect(isTransactionEnd('  -- 提交\n commit')).toBe(true)
    expect(isTransactionEnd('/* 收尾 */ END')).toBe(true)
  })

  it('回滚：ROLLBACK 的各种写法（含两阶段）与 PostgreSQL 的 ABORT', () => {
    expect(isTransactionEnd('ROLLBACK')).toBe(true)
    expect(isTransactionEnd('rollback work')).toBe(true)
    expect(isTransactionEnd('ROLLBACK TRANSACTION')).toBe(true)
    expect(isTransactionEnd('ROLLBACK AND NO CHAIN')).toBe(true)
    expect(isTransactionEnd("ROLLBACK PREPARED 'tx1'")).toBe(true)
    expect(isTransactionEnd('abort')).toBe(true)
  })

  it('回滚到保存点与释放保存点不结束事务，不算', () => {
    expect(isTransactionEnd('ROLLBACK TO SAVEPOINT s1')).toBe(false)
    expect(isTransactionEnd('rollback to s1')).toBe(false)
    expect(isTransactionEnd('ROLLBACK WORK TO SAVEPOINT s1')).toBe(false)
    expect(isTransactionEnd('rollback transaction\n  to s1')).toBe(false)
    expect(isTransactionEnd('RELEASE SAVEPOINT s1')).toBe(false)
    expect(isTransactionEnd('release s1')).toBe(false)
  })

  it('开始事务、设保存点与普通语句不算', () => {
    expect(isTransactionEnd('BEGIN')).toBe(false)
    expect(isTransactionEnd('START TRANSACTION')).toBe(false)
    expect(isTransactionEnd('SAVEPOINT s1')).toBe(false)
    expect(isTransactionEnd('select * from commits')).toBe(false)
    expect(isTransactionEnd('update t set ended = true')).toBe(false)
    expect(isTransactionEnd('committed')).toBe(false)
    expect(isTransactionEnd('endpoint')).toBe(false)
  })
})

describe('changesConsoleContext', () => {
  it('PostgreSQL：改 search_path 的语句（含注释开头、大小写不同）', () => {
    expect(changesConsoleContext('postgresql', 'SET search_path TO app, public')).toBe(true)
    expect(changesConsoleContext('postgresql', 'set session search_path = app')).toBe(true)
    expect(changesConsoleContext('postgresql', 'SET LOCAL search_path TO app')).toBe(true)
    expect(changesConsoleContext('postgresql', "set schema 'app'")).toBe(true)
    expect(changesConsoleContext('postgresql', 'RESET search_path')).toBe(true)
    expect(changesConsoleContext('postgresql', 'reset all')).toBe(true)
    expect(changesConsoleContext('postgresql', 'DISCARD ALL')).toBe(true)
    expect(changesConsoleContext('postgresql', '-- 切模式\nset search_path to app')).toBe(true)
  })

  it('PostgreSQL：换角色的语句也算（默认的 search_path 里有 "$user"）', () => {
    expect(changesConsoleContext('postgresql', 'SET ROLE app_owner')).toBe(true)
    expect(changesConsoleContext('postgresql', 'set local role app_owner')).toBe(true)
    expect(changesConsoleContext('postgresql', 'SET SESSION AUTHORIZATION alice')).toBe(true)
    expect(changesConsoleContext('postgresql', 'set session session authorization default')).toBe(
      true
    )
    expect(changesConsoleContext('postgresql', 'RESET ROLE')).toBe(true)
    expect(changesConsoleContext('postgresql', 'reset session authorization')).toBe(true)
    expect(changesConsoleContext('postgresql', 'set rolex = 1')).toBe(false)
  })

  it('PostgreSQL：改结构的语句也算（建、删 search_path 里的模式）', () => {
    expect(changesConsoleContext('postgresql', 'CREATE SCHEMA app')).toBe(true)
    expect(changesConsoleContext('postgresql', 'drop schema app cascade')).toBe(true)
    expect(changesConsoleContext('postgresql', 'REVOKE USAGE ON SCHEMA app FROM PUBLIC')).toBe(true)
  })

  it('PostgreSQL：结束事务的语句也算（事务里的 SET 随之生效或撤销）', () => {
    expect(changesConsoleContext('postgresql', 'COMMIT')).toBe(true)
    expect(changesConsoleContext('postgresql', '/* 撤销 */ rollback')).toBe(true)
    expect(changesConsoleContext('postgresql', 'ROLLBACK TO SAVEPOINT s1')).toBe(false)
  })

  it('PostgreSQL：别的 SET、查询不算', () => {
    expect(changesConsoleContext('postgresql', 'SET statement_timeout = 0')).toBe(false)
    expect(changesConsoleContext('postgresql', 'set search_path_x = 1')).toBe(false)
    expect(changesConsoleContext('postgresql', 'show search_path')).toBe(false)
    expect(changesConsoleContext('postgresql', 'select 1')).toBe(false)
    expect(changesConsoleContext('postgresql', 'use shop')).toBe(false)
  })

  it('MySQL / MariaDB：USE 与删库算，别的不算', () => {
    expect(changesConsoleContext('mysql', 'USE shop')).toBe(true)
    expect(changesConsoleContext('mysql', '-- 切库\nuse `shop`')).toBe(true)
    expect(changesConsoleContext('mysql', 'DROP DATABASE shop')).toBe(true)
    expect(changesConsoleContext('mysql', 'drop schema if exists shop')).toBe(true)
    expect(changesConsoleContext('mysql', 'drop table users')).toBe(false)
    expect(changesConsoleContext('mysql', 'select * from users')).toBe(false)
    expect(changesConsoleContext('mysql', 'COMMIT')).toBe(false)
    expect(changesConsoleContext('mysql', 'SET search_path TO app')).toBe(false)
  })

  it('SQLite 一律不算', () => {
    expect(changesConsoleContext('sqlite', 'use main')).toBe(false)
  })
})

describe('statementOutcomeText / consoleRunSummary', () => {
  const statement = (
    outcome: ConsoleStatementResult['outcome'],
    ms = 5
  ): ConsoleStatementResult => ({ sql: 'x', ms, outcome })

  it('行数、只取回了一部分、影响行数、报错原话、已取消', () => {
    expect(statementOutcomeText(statement({ kind: 'rows', count: 3, truncated: false }))).toBe(
      '3 行'
    )
    expect(statementOutcomeText(statement({ kind: 'rows', count: 10_000, truncated: true }))).toBe(
      '只取回了前 10000 行'
    )
    expect(statementOutcomeText(statement({ kind: 'affected', count: 2 }))).toBe('影响 2 行')
    expect(statementOutcomeText(statement({ kind: 'error', message: 'syntax error' }))).toBe(
      'syntax error'
    )
    expect(statementOutcomeText(statement({ kind: 'canceled' }))).toBe('已取消')
  })

  it('一条为结果与用时，多条为条数与总用时，没有语句为 null', () => {
    const one = statement({ kind: 'affected', count: 1 }, 12)
    expect(consoleRunSummary({ statements: [one], result: null })).toBe('影响 1 行 · 12 毫秒')
    expect(
      consoleRunSummary({ statements: [one, statement({ kind: 'canceled' }, 3)], result: null })
    ).toBe('2 条语句 · 15 毫秒')
    expect(consoleRunSummary({ statements: [], result: null })).toBeNull()
  })
})

describe('consoleRunResult', () => {
  const statement = (outcome: ConsoleStatementResult['outcome']): ConsoleStatementResult => ({
    sql: 'x',
    ms: 1,
    outcome
  })
  const result = {
    columns: [{ name: 'n', type: 'number' as const }],
    rows: [['1']],
    truncated: false
  }

  it('没有语句出错时为最后一个结果集（没有为 null）', () => {
    const rows = statement({ kind: 'rows', count: 1, truncated: false })
    expect(consoleRunResult({ statements: [rows], result })).toEqual({ failed: null, result })
    const affected = statement({ kind: 'affected', count: 2 })
    expect(consoleRunResult({ statements: [affected], result: null })).toEqual({
      failed: null,
      result: null
    })
  })

  it('有语句出错时为出错的那条，不出结果集', () => {
    const error = statement({ kind: 'error', message: 'syntax error' })
    const run = {
      statements: [statement({ kind: 'rows', count: 1, truncated: false }), error],
      result
    }
    expect(consoleRunResult(run)).toEqual({ failed: error, result: null })
  })

  it('已取消不算出错', () => {
    const run = { statements: [statement({ kind: 'canceled' })], result }
    expect(consoleRunResult(run)).toEqual({ failed: null, result })
  })
})

describe('consoleSearchPath', () => {
  const pg = (schema: string | null, searchPath: string): string[] =>
    consoleSearchPath({ kind: 'postgresql', database: 'shop', schema, searchPath })

  it('PostgreSQL：没写 pg_catalog 时它在最前，其后是 current_schema() 与 search_path 的其余各项', () => {
    // 默认的 search_path："$user" 对上了即 current_schema()，对不上时 current_schema() 为 public
    expect(pg('alice', '"$user", public')).toEqual(['pg_catalog', 'alice', 'public'])
    expect(pg('public', '"$user", public')).toEqual(['pg_catalog', 'public'])
    // 带引号的按原样、不带的折成小写；不存在的项留着（补全时查不到，无妨）
    expect(pg('Sales', '"Sales", Public, missing')).toEqual([
      'pg_catalog',
      'Sales',
      'public',
      'missing'
    ])
  })

  it('PostgreSQL：写了 pg_catalog 时按它写的位置；search_path 里的模式都不存在时只有各项', () => {
    expect(pg('public', 'public, pg_catalog')).toEqual(['public', 'pg_catalog'])
    expect(pg(null, 'missing')).toEqual(['pg_catalog', 'missing'])
  })

  it('MySQL / MariaDB 为控制台所在的库（没选为空）；Redis 为空', () => {
    expect(consoleSearchPath({ kind: 'mysql', database: 'shop' })).toEqual(['shop'])
    expect(consoleSearchPath({ kind: 'mysql', database: null })).toEqual([])
    expect(consoleSearchPath({ kind: 'redis', database: 3 })).toEqual([])
  })
})
