// 切词适配层：与 sqlparse 等价（期望值由 sqlparse 0.6 对同样的文字切出，略去空白），以及按位置纠正非保留字（只在
// 表名、别名、AS 之后与选择列表里）。
import { describe, expect, it } from 'vitest'
import type { SqlKind } from '@shared/data-source'
import { completionDialect } from './dialects'
import { T } from './sqlparse/tokens'
import { tokenize } from './token-adapter'

/** 去掉空白后的「类型 原文」（类型略去开头的 Token.）。 */
const sig = (text: string, kind: SqlKind = 'postgresql'): string[] =>
  tokenize(text, completionDialect(kind))
    .filter((t) => !t.ttype.startsWith(T.Text))
    .map((t) => `${t.ttype.replace(/^Token\./, '')} ${t.value}`)

/** 某个词的类型。 */
const typeOf = (text: string, word: string, kind: SqlKind = 'postgresql', nth = 0): string =>
  tokenize(text, completionDialect(kind))
    .filter((t) => t.value === word)
    [nth]!.ttype.replace(/^Token\./, '')

describe('与 sqlparse 的词法等价', () => {
  it.each<[string, string[]]>([
    [
      "SELECT a.b, count(*) FROM t1 LEFT OUTER JOIN t2 ON t1.id = t2.id WHERE x NOT LIKE 'a''b' ORDER BY 1 DESC NULLS LAST",
      [
        'Keyword.DML SELECT',
        'Name a',
        'Punctuation .',
        'Name b',
        'Punctuation ,',
        'Name count',
        'Punctuation (',
        'Wildcard *',
        'Punctuation )',
        'Keyword FROM',
        'Name t1',
        'Keyword LEFT OUTER JOIN',
        'Name t2',
        'Keyword ON',
        'Name t1',
        'Punctuation .',
        'Name id',
        'Operator.Comparison =',
        'Name t2',
        'Punctuation .',
        'Name id',
        'Keyword WHERE',
        'Name x',
        'Operator.Comparison NOT LIKE',
        "Literal.String.Single 'a''b'",
        'Keyword ORDER BY',
        'Literal.Number.Integer 1',
        'Keyword.Order DESC NULLS LAST'
      ]
    ],
    [
      'CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ select 1 $$ LANGUAGE sql',
      [
        'Keyword.DDL CREATE OR REPLACE',
        'Keyword FUNCTION',
        'Name f',
        'Punctuation (',
        'Punctuation )',
        'Keyword RETURNS',
        'Name.Builtin int',
        'Keyword AS',
        'Literal $$ select 1 $$',
        'Keyword LANGUAGE',
        'Keyword sql'
      ]
    ],
    [
      "select x::int, y -> 'k' from t where z @> '{}' and w is not null",
      [
        'Keyword.DML select',
        'Name x',
        'Punctuation ::',
        'Name.Builtin int',
        'Punctuation ,',
        'Name y',
        'Operator ->',
        "Literal.String.Single 'k'",
        'Keyword from',
        'Name t',
        'Keyword where',
        'Name z',
        'Operator @>',
        "Literal.String.Single '{}'",
        'Keyword and',
        'Name w',
        'Keyword is',
        'Keyword not null'
      ]
    ],
    [
      'SELECT * FROM t WHERE a IN (1, 2.5) GROUP BY c UNION ALL SELECT 1',
      [
        'Keyword.DML SELECT',
        'Wildcard *',
        'Keyword FROM',
        'Name t',
        'Keyword WHERE',
        'Name a',
        'Keyword IN',
        'Punctuation (',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        'Literal.Number.Float 2.5',
        'Punctuation )',
        'Keyword GROUP BY',
        'Name c',
        'Keyword UNION ALL',
        'Keyword.DML SELECT',
        'Literal.Number.Integer 1'
      ]
    ],
    [
      '-- c\nselect 1; /* b */ select 2',
      [
        'Comment.Single -- c\n',
        'Keyword.DML select',
        'Literal.Number.Integer 1',
        'Punctuation ;',
        'Comment.Multiline /* b */',
        'Keyword.DML select',
        'Literal.Number.Integer 2'
      ]
    ],
    [
      'select * from foo where bar = 1 and baz between qux and ',
      [
        'Keyword.DML select',
        'Wildcard *',
        'Keyword from',
        'Name foo',
        'Keyword where',
        'Name bar',
        'Operator.Comparison =',
        'Literal.Number.Integer 1',
        'Keyword and',
        'Name baz',
        'Keyword between',
        'Name qux',
        'Keyword and'
      ]
    ],
    [
      "insert into abc (id, x) values (1, 'def')",
      [
        'Keyword.DML insert',
        'Keyword into',
        'Name abc',
        'Punctuation (',
        'Name id',
        'Punctuation ,',
        'Name x',
        'Punctuation )',
        'Keyword values',
        'Punctuation (',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        "Literal.String.Single 'def'",
        'Punctuation )'
      ]
    ],
    // 没收尾的引号：sqlparse 出一个 Error 记号后接着往下切
    ["select 'abc", ['Keyword.DML select', "Error '", 'Name abc']],
    ['select "ab', ['Keyword.DML select', 'Error "', 'Name ab']],
    // lang-sql 只认 ASCII 的词，Unicode 名字补切后与 sqlparse 相同
    [
      'select 名字 from 用户 u',
      ['Keyword.DML select', 'Name 名字', 'Keyword from', 'Name 用户', 'Name u']
    ]
  ])('%j', (text, expected) => {
    expect(sig(text)).toEqual(expected)
  })

  it('句子里的每个字符都在记号里，位置连续', () => {
    const text = "SELECT u.名字, `x` FROM t -- c\nWHERE a = 'b' /* d */ /*!50003 AND c = 1 */;"
    for (const kind of ['postgresql', 'mysql', 'mariadb', 'sqlite'] as const) {
      const toks = tokenize(text, completionDialect(kind))
      expect(toks.map((t) => t.value).join('')).toBe(text)
      toks.forEach((t, i) => {
        if (i > 0) expect(t.pos).toBe(toks[i - 1]!.pos + toks[i - 1]!.value.length)
      })
    }
  })
})

describe('各方言的引号、注释与变量（lang-sql 切词）', () => {
  it('MySQL：反引号是名字，# 是注释，双引号是字符串，@变量是名字', () => {
    expect(sig('select `a b`, "s", @v from t # c', 'mysql')).toEqual([
      'Keyword.DML select',
      'Name `a b`',
      'Punctuation ,',
      'Literal.String.Single "s"',
      'Punctuation ,',
      'Name @v',
      'Keyword from',
      'Name t',
      'Comment.Single # c'
    ])
  })

  it('MySQL / MariaDB：-- 之后是空白或已到末尾才是注释（同 mysql 客户端）', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(sig('--\nselect 1 --\t2\n-- x\nfrom t --', kind)).toEqual([
        'Comment.Single --\n',
        'Keyword.DML select',
        'Literal.Number.Integer 1',
        'Comment.Single --\t2\n',
        'Comment.Single -- x\n',
        'Keyword from',
        'Name t',
        'Comment.Single --'
      ])
      expect(sig('select 1--1', kind)).toEqual([
        'Keyword.DML select',
        'Literal.Number.Integer 1',
        'Operator -',
        'Literal.Number.Integer -1'
      ])
    }
  })

  it('MySQL / MariaDB 的可执行注释：内容照常切词，开头（连同版本号）与结尾另记', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(sig('/*!40101 SET NAMES utf8mb4 */', kind)).toEqual([
        'Comment.Multiline.Version /*!40101',
        'Keyword SET',
        'Keyword NAMES',
        'Name utf8mb4',
        'Comment.Multiline.Version */'
      ])
      expect(sig('/*!50003 CREATE*/ /*! TRIGGER', kind)).toEqual([
        'Comment.Multiline.Version /*!50003',
        'Keyword.DDL CREATE',
        'Comment.Multiline.Version */',
        'Comment.Multiline.Version /*!',
        'Keyword TRIGGER'
      ])
    }
  })

  it('可执行注释的结尾照 mysql 客户端：字符串、带引号的名字与注释里的 */ 不算；没有结尾时读到末尾', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(sig("/*!40101 select '*/', `*/` -- */\n*/ select 1", kind)).toEqual([
        'Comment.Multiline.Version /*!40101',
        'Keyword.DML select',
        "Literal.String.Single '*/'",
        'Punctuation ,',
        'Name `*/`',
        'Comment.Single -- */\n',
        'Comment.Multiline.Version */',
        'Keyword.DML select',
        'Literal.Number.Integer 1'
      ])
      // 末尾的 */ 在没收尾的字符串里：注释没有结尾，字符串照 sqlparse 记为 Error 后接着切
      expect(sig("/*!40101 select '*/", kind)).toEqual([
        'Comment.Multiline.Version /*!40101',
        'Keyword.DML select',
        "Error '",
        'Wildcard *',
        'Operator /'
      ])
    }
  })

  it('/*M! 只在 MariaDB 上是可执行注释；其余方言的 /*! 是普通注释', () => {
    expect(sig('/*M!100616 SET a = 1 */', 'mariadb')).toEqual([
      'Comment.Multiline.Version /*M!100616',
      'Keyword SET',
      'Name a',
      'Operator.Comparison =',
      'Literal.Number.Integer 1',
      'Comment.Multiline.Version */'
    ])
    expect(sig('/*M!100616 SET a = 1 */', 'mysql')).toEqual([
      'Comment.Multiline /*M!100616 SET a = 1 */'
    ])
    for (const kind of ['postgresql', 'sqlite'] as const) {
      expect(sig('/*!40101 SET a = 1 */', kind)).toEqual([
        'Comment.Multiline /*!40101 SET a = 1 */'
      ])
    }
  })

  it('SQLite：[名字] 是名字，:p / $x / ?1 是占位符', () => {
    expect(sig('select [a b] from t where x = :p or y = $x or z = ?1', 'sqlite')).toEqual([
      'Keyword.DML select',
      'Name [a b]',
      'Keyword from',
      'Name t',
      'Keyword where',
      'Name x',
      'Operator.Comparison =',
      'Name.Placeholder :p',
      'Keyword or',
      'Name y',
      'Operator.Comparison =',
      'Name.Placeholder $x',
      'Keyword or',
      'Name z',
      'Operator.Comparison =',
      'Name.Placeholder ?1'
    ])
  })

  it('PostgreSQL：$1、? 是占位符，E 字符串带反斜杠转义', () => {
    expect(sig("select $1, ?, E'a\\'b'")).toEqual([
      'Keyword.DML select',
      'Name.Placeholder $1',
      'Punctuation ,',
      'Name.Placeholder ?',
      'Punctuation ,',
      "Literal.String.Single E'a\\'b'"
    ])
  })

  it('变量照 lang-sql：MySQL 的 @a、@@global 是名字（sqlparse 另切出 @ 运算符）', () => {
    expect(typeOf('SET @a = 1', '@a', 'mysql')).toBe('Name')
    expect(typeOf('SELECT @@global.x', '@@global', 'mysql')).toBe('Name')
  })

  it('lang-sql 标为命令行命令的词也查 sqlparse 的表：SQLite 的 EXPLAIN 是关键字，MySQL 的 status 是名字', () => {
    expect(typeOf('EXPLAIN SELECT 1', 'EXPLAIN', 'sqlite')).toBe('Keyword')
    expect(typeOf('SELECT status FROM t', 'status', 'mysql')).toBe('Name')
  })
})

describe('运算符与只有符号的变量照 sqlparse（期望值由 sqlparse 0.6 切出）', () => {
  it.each<[string, SqlKind[], string[]]>([
    [
      'SELECT a / b ~ c, d/%e, f~=g FROM t',
      ['mysql', 'mariadb', 'sqlite', 'postgresql'],
      [
        'Keyword.DML SELECT',
        'Name a',
        'Operator /',
        'Name b',
        'Operator.Comparison ~',
        'Name c',
        'Punctuation ,',
        'Name d',
        'Operator /%',
        'Name e',
        'Punctuation ,',
        'Name f',
        'Operator.Comparison ~=',
        'Name g',
        'Keyword FROM',
        'Name t'
      ]
    ],
    [
      'SELECT a/-1, x=-1, y-1.5, z+-1, w - 1 FROM t',
      ['mysql', 'mariadb', 'sqlite', 'postgresql'],
      [
        'Keyword.DML SELECT',
        'Name a',
        'Operator /-',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        'Name x',
        'Operator.Comparison =',
        'Literal.Number.Integer -1',
        'Punctuation ,',
        'Name y',
        'Literal.Number.Float -1.5',
        'Punctuation ,',
        'Name z',
        'Operator +-',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        'Name w',
        'Operator -',
        'Literal.Number.Integer 1',
        'Keyword FROM',
        'Name t'
      ]
    ],
    [
      'SELECT a/b, ~a, a~b FROM t WHERE x/2 > 1',
      ['mysql', 'mariadb'],
      [
        'Keyword.DML SELECT',
        'Name a',
        'Operator /',
        'Name b',
        'Punctuation ,',
        'Operator.Comparison ~',
        'Name a',
        'Punctuation ,',
        'Name a',
        'Operator.Comparison ~',
        'Name b',
        'Keyword FROM',
        'Name t',
        'Keyword WHERE',
        'Name x',
        'Operator /',
        'Literal.Number.Integer 2',
        'Operator.Comparison >',
        'Literal.Number.Integer 1'
      ]
    ],
    [
      'SELECT @, @@ FROM t',
      ['mysql', 'mariadb'],
      ['Keyword.DML SELECT', 'Operator @', 'Punctuation ,', 'Operator @@', 'Keyword FROM', 'Name t']
    ],
    [
      'SELECT a : b, :, ::, c := 1 FROM t',
      ['sqlite'],
      [
        'Keyword.DML SELECT',
        'Name a',
        'Punctuation :',
        'Name b',
        'Punctuation ,',
        'Punctuation :',
        'Punctuation ,',
        'Punctuation ::',
        'Punctuation ,',
        'Name c',
        'Assignment :=',
        'Literal.Number.Integer 1',
        'Keyword FROM',
        'Name t'
      ]
    ],
    [
      'SELECT a ^ b, $ FROM t',
      ['sqlite'],
      [
        'Keyword.DML SELECT',
        'Name a',
        'Operator ^',
        'Name b',
        'Punctuation ,',
        'Error $',
        'Keyword FROM',
        'Name t'
      ]
    ]
  ])('%s（%s）', (text, kinds, expected) => {
    for (const kind of kinds) expect(sig(text, kind)).toEqual(expected)
  })
})

describe('词的类别照 sqlparse 的关键字表（期望值由 sqlparse 0.6 切出）', () => {
  it.each<[string, string[]]>([
    [
      // lang-sql 算关键字、sqlparse 算名字的词
      'SELECT name, id, value, token, state, action FROM t',
      [
        'Keyword.DML SELECT',
        'Name name',
        'Punctuation ,',
        'Name id',
        'Punctuation ,',
        'Name value',
        'Punctuation ,',
        'Name token',
        'Punctuation ,',
        'Name state',
        'Punctuation ,',
        'Name action',
        'Keyword FROM',
        'Name t'
      ]
    ],
    [
      // 条件里是关键字的照旧（不按位置纠正）
      'SELECT * FROM t WHERE type = 1 AND key > 2 AND year < 3',
      [
        'Keyword.DML SELECT',
        'Wildcard *',
        'Keyword FROM',
        'Name t',
        'Keyword WHERE',
        'Keyword type',
        'Operator.Comparison =',
        'Literal.Number.Integer 1',
        'Keyword AND',
        'Keyword key',
        'Operator.Comparison >',
        'Literal.Number.Integer 2',
        'Keyword AND',
        'Keyword year',
        'Operator.Comparison <',
        'Literal.Number.Integer 3'
      ]
    ],
    [
      'SELECT a::jsonb, b::int, c::text',
      [
        'Keyword.DML SELECT',
        'Name a',
        'Punctuation ::',
        'Keyword jsonb',
        'Punctuation ,',
        'Name b',
        'Punctuation ::',
        'Name.Builtin int',
        'Punctuation ,',
        'Name c',
        'Punctuation ::',
        'Name.Builtin text'
      ]
    ],
    [
      'SELECT row_number() OVER (PARTITION ',
      [
        'Keyword.DML SELECT',
        'Name row_number',
        'Punctuation (',
        'Punctuation )',
        'Keyword OVER',
        'Punctuation (',
        'Keyword PARTITION'
      ]
    ],
    [
      'UPDATE t SET name = 1, type = 2',
      [
        'Keyword.DML UPDATE',
        'Name t',
        'Keyword SET',
        'Name name',
        'Operator.Comparison =',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        'Keyword type',
        'Operator.Comparison =',
        'Literal.Number.Integer 2'
      ]
    ],
    [
      'ALTER TABLE t ALTER COLUMN name TYPE int',
      [
        'Keyword.DDL ALTER',
        'Keyword TABLE',
        'Name t',
        'Keyword.DDL ALTER',
        'Keyword COLUMN',
        'Name name',
        'Keyword TYPE',
        'Name.Builtin int'
      ]
    ],
    [
      'INSERT INTO t (id, key) VALUES (1, 2)',
      [
        'Keyword.DML INSERT',
        'Keyword INTO',
        'Name t',
        'Punctuation (',
        'Name id',
        'Punctuation ,',
        'Keyword key',
        'Punctuation )',
        'Keyword VALUES',
        'Punctuation (',
        'Literal.Number.Integer 1',
        'Punctuation ,',
        'Literal.Number.Integer 2',
        'Punctuation )'
      ]
    ],
    ['SELECT a DIV b', ['Keyword.DML SELECT', 'Name a', 'Operator DIV', 'Name b']]
  ])('%j', (text, expected) => {
    expect(sig(text)).toEqual(expected)
  })
})

describe('按位置把非保留字纠正为名字（与 sqlparse 有意不同之处）', () => {
  it('选择列表里的一项', () => {
    expect(typeOf('SELECT type ', 'type')).toBe('Name')
    expect(typeOf('SELECT id, type, key FROM t', 'type')).toBe('Name')
    expect(typeOf('SELECT id, type, key FROM t', 'key')).toBe('Name')
    expect(typeOf('SELECT DISTINCT data FROM t', 'data')).toBe('Name')
    expect(typeOf('SELECT count(*), session FROM t', 'session')).toBe('Name')
    expect(typeOf('INSERT INTO t SELECT a, type FROM s', 'type')).toBe('Name')
  })

  it('选择列表以外的表达式照 sqlparse', () => {
    expect(typeOf('SELECT type FROM t WHERE type = 1', 'type', 'postgresql', 1)).toBe('Keyword')
    expect(typeOf('SELECT a FROM t ORDER BY a, type', 'type')).toBe('Keyword')
    expect(typeOf('SELECT count(type) FROM t', 'type')).toBe('Keyword')
    expect(typeOf('UPDATE t SET type = 1', 'type')).toBe('Keyword')
  })

  it('表名与别名的位置', () => {
    expect(typeOf('SELECT * FROM data d JOIN key k ON d.id = k.id', 'data')).toBe('Name')
    expect(typeOf('SELECT * FROM data d JOIN key k ON d.id = k.id', 'key')).toBe('Name')
    expect(typeOf('SELECT * FROM t1 value, t2', 'value')).toBe('Name')
    expect(typeOf('SELECT * FROM t1, data', 'data')).toBe('Name')
    expect(typeOf('INSERT INTO data VALUES (1)', 'data')).toBe('Name')
    expect(typeOf('UPDATE data SET a = 1', 'data')).toBe('Name')
    expect(typeOf('SELECT a AS type FROM t', 'type')).toBe('Name')
  })

  it('关键字用法不动', () => {
    expect(typeOf('ALTER TABLE t ALTER COLUMN c TYPE int', 'TYPE')).toBe('Keyword')
    expect(typeOf('SELECT * FROM t WHERE EXISTS (SELECT 1)', 'EXISTS')).toBe('Keyword')
    expect(typeOf('SELECT rank() OVER (PARTITION BY a)', 'PARTITION')).toBe('Keyword')
    expect(typeOf('SET SCHEMA ', 'SCHEMA')).toBe('Keyword')
    expect(typeOf('ALTER TABLE t SET SCHEMA s', 'SCHEMA')).toBe('Keyword')
    expect(typeOf('GRANT USAGE ON SCHEMA s TO u', 'SCHEMA')).toBe('Keyword')
    expect(typeOf('WITH x AS MATERIALIZED (SELECT 1) SELECT 1', 'MATERIALIZED')).toBe('Keyword')
    expect(typeOf('INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE SET name = 1', 'SET')).toBe(
      'Keyword'
    )
    expect(typeOf('SELECT * FROM t FOR UPDATE NOWAIT', 'UPDATE')).toBe('Keyword.DML')
  })

  it('保留字不纠正（各方言的保留字表）', () => {
    expect(typeOf('SELECT * FROM user', 'user')).toBe('Keyword')
    expect(typeOf('SELECT * FROM key', 'key', 'mysql')).toBe('Keyword')
    expect(typeOf('SELECT * FROM key', 'key', 'sqlite')).toBe('Name')
  })

  it('类型在表名 / 别名的位置才纠正（参数表、CAST 里照旧）', () => {
    expect(typeOf('SELECT * FROM text', 'text')).toBe('Name')
    expect(typeOf('CREATE FUNCTION f(int, text) RETURNS int', 'text')).toBe('Name.Builtin')
    expect(typeOf('SELECT CAST(a AS text)', 'text')).toBe('Name.Builtin')
  })
})
