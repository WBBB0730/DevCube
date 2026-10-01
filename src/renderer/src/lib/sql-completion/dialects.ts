// 各方言的补全数据与切词设定：PostgreSQL 照 pgcli，MySQL / MariaDB 照 mycli，SQLite 照 litecli（三者同源）。
import type { SQLDialect } from '@codemirror/lang-sql'
import type { SqlKind } from '@shared/data-source'
import { dialectOf, type SqlDialect } from '@shared/data-source-query'
import { codemirrorDialect } from '../data-source-sql'
import mysqlLiterals from './literals/mysql.json'
import pgLiterals from './literals/postgresql.json'
import sqliteLiterals from './literals/sqlite.json'
import { MARIADB_RESERVED, MYSQL_RESERVED, SQLITE_RESERVED } from './reserved-words'

export interface Dialect {
  kind: SqlKind
  /** 补全逻辑照搬的来源（MariaDB 同 MySQL） */
  family: SqlDialect
  codemirror: SQLDialect
  /** 不加引号不能作标识符的关键字（切词适配层按位置纠正非保留字时用） */
  reserved: ReadonlySet<string>
  /** 关键字 → 常见的后续关键字（pgcli 的 keywords_tree；mycli / litecli 没有，各关键字的后续为空） */
  keywordsTree: Readonly<Record<string, readonly string[]>>
  /** 补全的关键字（pgcli：keywords_tree 的键另补 PG_MISSING_KEYWORDS，get_keyword_matches 与 PrevalenceCounter 都用它；mycli / litecli：各自的 keywords） */
  keywords: readonly string[]
  /** 内置函数 */
  functions: readonly string[]
  /** 内置类型 */
  datatypes: readonly string[]
  /**
   * 补全出的名字遇到这些词要加引号（pgcli escape_name 用 reserved_words；mycli / litecli 用关键字拆开的各词），
   * 与函数名一起判断。
   */
  quoteWords: ReadonlySet<string>
  /** 加引号用的字符（pgcli 双引号；mycli / litecli 反引号） */
  quote: '"' | '`'
  /** 不加引号就能用的名字（pgcli / mycli / litecli 各自的 name_pattern） */
  namePattern: RegExp
  /** CHANGE MASTER TO 之后的选项（mycli change_items；其余方言为空） */
  changeItems: readonly string[]
}

/** mycli / litecli SQLCompleter.__init__：reserved_words 为各关键字拆开的各词。 */
function wordsOf(keywords: readonly string[]): ReadonlySet<string> {
  return new Set(keywords.flatMap((keyword) => keyword.split(/\s+/)))
}

/** pgcli 的补全关键字表漏掉、写查询又常用的 PostgreSQL 关键字（在它的保留字表里）：补在 keywords_tree 的键之后 */
const PG_MISSING_KEYWORDS = [
  'ILIKE',
  'SIMILAR',
  'ISNULL',
  'NOTNULL',
  'OFFSET',
  'FETCH',
  'RETURNING',
  'LATERAL',
  'WINDOW',
  'EXCEPT',
  'INNER',
  'CROSS',
  'NATURAL',
  'END',
  'TRUE',
  'FALSE',
  'CAST',
  'ARRAY',
  'CURRENT_USER',
  'CURRENT_SCHEMA'
]

const POSTGRESQL: Omit<Dialect, 'kind' | 'family' | 'codemirror'> = {
  reserved: new Set(pgLiterals.reserved),
  keywordsTree: pgLiterals.keywords,
  keywords: [...Object.keys(pgLiterals.keywords), ...PG_MISSING_KEYWORDS],
  functions: pgLiterals.functions,
  datatypes: pgLiterals.datatypes,
  quoteWords: new Set(pgLiterals.reserved),
  quote: '"',
  namePattern: /^[_a-z][_a-z0-9$]*$/,
  changeItems: []
}

const MYSQL: Omit<Dialect, 'kind' | 'family' | 'codemirror' | 'reserved'> = {
  keywordsTree: {},
  keywords: mysqlLiterals.keywords,
  functions: mysqlLiterals.functions,
  datatypes: mysqlLiterals.datatypes,
  quoteWords: wordsOf(mysqlLiterals.keywords),
  quote: '`',
  namePattern: /^[_a-zA-Z][_a-zA-Z0-9$]*$/,
  changeItems: mysqlLiterals.changeItems
}

const SQLITE: Omit<Dialect, 'kind' | 'family' | 'codemirror'> = {
  reserved: SQLITE_RESERVED,
  keywordsTree: {},
  keywords: sqliteLiterals.keywords,
  functions: sqliteLiterals.functions,
  datatypes: sqliteLiterals.datatypes,
  quoteWords: wordsOf(sqliteLiterals.keywords),
  quote: '`',
  namePattern: /^[_a-zA-Z][_a-zA-Z0-9$]*$/,
  changeItems: []
}

const cache = new Map<SqlKind, Dialect>()

/** 数据源类型的补全方言（补全数据与切词设定；SQL 方言的名字见 shared 的 dialectOf）。 */
export function completionDialect(kind: SqlKind): Dialect {
  let dialect = cache.get(kind)
  if (dialect === undefined) {
    const family = dialectOf(kind)
    const codemirror = codemirrorDialect(kind)
    switch (kind) {
      case 'postgresql':
        dialect = { kind, family, codemirror, ...POSTGRESQL }
        break
      case 'mysql':
        dialect = { kind, family, codemirror, reserved: MYSQL_RESERVED, ...MYSQL }
        break
      case 'mariadb':
        dialect = { kind, family, codemirror, reserved: MARIADB_RESERVED, ...MYSQL }
        break
      case 'sqlite':
        dialect = { kind, family, codemirror, ...SQLITE }
        break
    }
    cache.set(kind, dialect)
  }
  return dialect
}
