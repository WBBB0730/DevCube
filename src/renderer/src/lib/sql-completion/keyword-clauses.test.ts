// 翻译自 Tabularis tests/utils/sqlContext.test.ts 的「analyzeSqlContext - clause detection」与 getKeywordRelevance
// 里「hidden」的用例。未翻译：inString / inComment / nestingLevel / statementStart / lastTableRef /
// findStatementScopeEnd / getSuggestionKinds 与关键字加权（只移植了子句判断与按子句隐藏关键字）。
import { describe, expect, it } from 'vitest'
import { completionDialect } from './dialects'
import { keywordAllowed, sqlClauseAt, type SqlClause } from './keyword-clauses'

const clauseOf = (
  text: string,
  kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql'
): SqlClause => sqlClauseAt(text, completionDialect(kind))

describe('sqlClauseAt（Tabularis analyzeSqlContext - clause detection）', () => {
  it('reports start on an empty buffer', () => {
    expect(clauseOf('')).toBe('start')
    expect(clauseOf('   \n  ')).toBe('start')
  })

  it('reports start while typing the first word', () => {
    // 打了一半的词是名字，不是子句关键字
    expect(clauseOf('SEL')).toBe('start')
  })

  it('reports select inside the SELECT list', () => {
    expect(clauseOf('SELECT ')).toBe('select')
    expect(clauseOf('SELECT id, na')).toBe('select')
    expect(clauseOf('select distinct ')).toBe('select')
  })

  it('reports from after FROM', () => {
    expect(clauseOf('SELECT * FROM ')).toBe('from')
    expect(clauseOf('SELECT * FROM use')).toBe('from')
    expect(clauseOf('SELECT * FROM db.')).toBe('from')
  })

  it('reports join after any JOIN variant', () => {
    expect(clauseOf('SELECT * FROM a JOIN ')).toBe('join')
    expect(clauseOf('SELECT * FROM a LEFT JOIN ')).toBe('join')
    expect(clauseOf('SELECT * FROM a LEFT OUTER JOIN ')).toBe('join')
    expect(clauseOf('SELECT * FROM a CROSS JOIN ')).toBe('join')
  })

  it('reports on inside a join condition', () => {
    expect(clauseOf('SELECT * FROM a JOIN b ON ')).toBe('on')
    expect(clauseOf('SELECT * FROM a JOIN b ON a.id = b.a_id AND ')).toBe('on')
  })

  it('reports using after USING', () => {
    expect(clauseOf('SELECT * FROM a JOIN b USING ')).toBe('using')
  })

  it('reports where inside WHERE conditions', () => {
    expect(clauseOf('SELECT * FROM t WHERE ')).toBe('where')
    expect(clauseOf('SELECT * FROM t WHERE a = 1 AND ')).toBe('where')
    expect(clauseOf('SELECT * FROM t WHERE a = 1 OR NOT ')).toBe('where')
    expect(clauseOf('SELECT * FROM t WHERE (a = 1 AND ')).toBe('where')
  })

  it('reports group-by / order-by / window from two-word keywords', () => {
    expect(clauseOf('SELECT * FROM t GROUP BY ')).toBe('group-by')
    expect(clauseOf('SELECT * FROM t ORDER BY ')).toBe('order-by')
    expect(clauseOf('SELECT rank() OVER (PARTITION BY ')).toBe('window')
  })

  it('does not treat a lone BY as a clause change', () => {
    expect(clauseOf('SELECT * FROM t WHERE by ')).toBe('where')
  })

  it('reports having after HAVING', () => {
    expect(clauseOf('SELECT a FROM t GROUP BY a HAVING ')).toBe('having')
  })

  it('reports limit after LIMIT / OFFSET / FETCH', () => {
    expect(clauseOf('SELECT * FROM t LIMIT ')).toBe('limit')
    expect(clauseOf('SELECT * FROM t LIMIT 10 OFFSET ')).toBe('limit')
    expect(clauseOf('SELECT * FROM t FETCH ')).toBe('limit')
  })

  it('reports update and set for UPDATE statements', () => {
    expect(clauseOf('UPDATE ')).toBe('update')
    expect(clauseOf('UPDATE users SET ')).toBe('set')
    expect(clauseOf('UPDATE users SET name = 1, ')).toBe('set')
  })

  it('reports where in an UPDATE with WHERE', () => {
    expect(clauseOf('UPDATE users SET a = 1 WHERE ')).toBe('where')
  })

  it('reports delete before FROM and from after it', () => {
    expect(clauseOf('DELETE ')).toBe('delete')
    expect(clauseOf('DELETE FROM ')).toBe('from')
  })

  it('reports insert-into after INSERT and INTO', () => {
    expect(clauseOf('INSERT ')).toBe('insert-into')
    expect(clauseOf('INSERT INTO ')).toBe('insert-into')
    expect(clauseOf('REPLACE ')).toBe('insert-into')
  })

  it('reports insert-columns inside the INSERT column list', () => {
    expect(clauseOf('INSERT INTO users (')).toBe('insert-columns')
    expect(clauseOf('INSERT INTO users (id, na')).toBe('insert-columns')
    expect(clauseOf('INSERT INTO "users" (')).toBe('insert-columns')
  })

  it('reports values inside VALUES', () => {
    expect(clauseOf('INSERT INTO users (id) VALUES ')).toBe('values')
    expect(clauseOf('INSERT INTO users (id) VALUES (')).toBe('values')
  })

  it('reports case inside CASE expressions and restores on END', () => {
    expect(clauseOf('SELECT CASE ')).toBe('case')
    expect(clauseOf('SELECT CASE WHEN a = 1 THEN ')).toBe('case')
    expect(clauseOf('SELECT CASE WHEN a = 1 THEN 2 ELSE ')).toBe('case')
    expect(clauseOf('SELECT CASE WHEN a THEN 1 END, ')).toBe('select')
  })

  it('handles nested CASE expressions', () => {
    expect(clauseOf('SELECT CASE WHEN a THEN CASE WHEN b THEN 1 END ')).toBe('case')
    expect(clauseOf('SELECT CASE WHEN a THEN CASE WHEN b THEN 1 END ELSE 2 END ')).toBe('select')
  })

  it('reports function-args inside function calls', () => {
    expect(clauseOf('SELECT count(')).toBe('function-args')
    expect(clauseOf('SELECT coalesce(a, ')).toBe('function-args')
    expect(clauseOf('SELECT * FROM t WHERE lower(')).toBe('function-args')
  })

  it('restores the outer clause after a function call closes', () => {
    expect(clauseOf('SELECT count(id) ')).toBe('select')
    expect(clauseOf('SELECT * FROM t WHERE lower(name) = ')).toBe('where')
  })

  it('reports in-list inside IN (...)', () => {
    expect(clauseOf('SELECT * FROM t WHERE id IN (')).toBe('in-list')
    expect(clauseOf('SELECT * FROM t WHERE id IN (1, ')).toBe('in-list')
  })

  it('switches to select inside an IN subquery', () => {
    expect(clauseOf('SELECT * FROM t WHERE id IN (SELECT ')).toBe('select')
    expect(clauseOf('SELECT * FROM t WHERE id IN (SELECT x FROM ')).toBe('from')
  })

  it('tracks subqueries in FROM and restores after they close', () => {
    expect(clauseOf('SELECT * FROM (SELECT ')).toBe('select')
    expect(clauseOf('SELECT * FROM (SELECT id FROM inner_t) ')).toBe('from')
  })

  it('inherits the clause inside plain expression groups', () => {
    expect(clauseOf('SELECT (a + ')).toBe('select')
    expect(clauseOf('SELECT * FROM t WHERE (')).toBe('where')
  })

  it('reports union between set operations and select after it', () => {
    expect(clauseOf('SELECT a FROM t UNION ')).toBe('union')
    expect(clauseOf('SELECT a FROM t UNION ALL ')).toBe('union')
    expect(clauseOf('SELECT a FROM t UNION SELECT ')).toBe('select')
    expect(clauseOf('SELECT a FROM t INTERSECT ')).toBe('union')
    expect(clauseOf('SELECT a FROM t EXCEPT ')).toBe('union')
  })

  it('reports DDL clauses', () => {
    expect(clauseOf('CREATE ')).toBe('create')
    expect(clauseOf('CREATE TABLE ')).toBe('create')
    expect(clauseOf('DROP TABLE ')).toBe('drop')
    expect(clauseOf('ALTER TABLE ')).toBe('alter')
    expect(clauseOf('TRUNCATE ')).toBe('truncate')
    expect(clauseOf('DROP TABLE IF EXISTS ')).toBe('drop')
  })

  it('reports returning after RETURNING', () => {
    expect(clauseOf('DELETE FROM t WHERE id = 1 RETURNING ')).toBe('returning')
  })

  it('handles WITH and CTE bodies', () => {
    expect(clauseOf('WITH ')).toBe('with')
    expect(clauseOf('WITH x AS (')).toBe('start')
    expect(clauseOf('WITH x AS (SELECT ')).toBe('select')
    expect(clauseOf('WITH x AS (SELECT 1) ')).toBe('with')
    expect(clauseOf('WITH x AS (SELECT 1) SELECT * FROM ')).toBe('from')
  })

  it('resets state at statement separators', () => {
    expect(clauseOf('SELECT * FROM t; ')).toBe('start')
    expect(clauseOf('SELECT * FROM t; SELECT ')).toBe('select')
    expect(clauseOf('SELECT * FROM t WHERE (a = 1; UPDATE ')).toBe('update')
  })

  it('ignores keywords inside string literals', () => {
    expect(clauseOf("SELECT 'FROM WHERE' ")).toBe('select')
    expect(clauseOf("SELECT * FROM t WHERE a = 'DROP TABLE x' AND ")).toBe('where')
  })

  it('ignores keywords inside comments', () => {
    expect(clauseOf('SELECT 1 -- WHERE nothing\n')).toBe('select')
    expect(clauseOf('SELECT /* FROM t WHERE */ ')).toBe('select')
  })

  // 改动：引号按方言切（lang-sql）：双引号在 PostgreSQL 里、反引号在 MySQL 里、方括号在 SQLite 里是名字的引号。
  it('treats quoted identifiers as opaque identifiers', () => {
    expect(clauseOf('SELECT * FROM "my table" WHERE ')).toBe('where')
    expect(clauseOf('SELECT * FROM `from` WHERE ', 'mysql')).toBe('where')
    expect(clauseOf('SELECT * FROM [select] WHERE ', 'sqlite')).toBe('where')
    // 带引号的名字后面跟 ( 也当作函数调用
    expect(clauseOf('SELECT "my func"(')).toBe('function-args')
  })

  it('is case-insensitive for keywords', () => {
    expect(clauseOf('select * from t where ')).toBe('where')
    expect(clauseOf('Select * From t Group By ')).toBe('group-by')
  })
})

describe('keywordAllowed（Tabularis getKeywordRelevance 的 hidden）', () => {
  it('hides WHEN outside CASE so "wh" selects WHERE', () => {
    expect(keywordAllowed('from', 'WHEN')).toBe(false)
    expect(keywordAllowed('from', 'WHERE')).toBe(true)
    expect(keywordAllowed('where', 'WHEN')).toBe(false)
    expect(keywordAllowed('select', 'WHEN')).toBe(false)
  })

  it('shows CASE-only keywords inside CASE', () => {
    for (const kw of ['WHEN', 'THEN', 'ELSE', 'END']) expect(keywordAllowed('case', kw)).toBe(true)
  })

  it('restricts ON to join (and MySQL VALUES … ON DUPLICATE KEY)', () => {
    expect(keywordAllowed('join', 'ON')).toBe(true)
    expect(keywordAllowed('values', 'ON')).toBe(true)
    expect(keywordAllowed('select', 'ON')).toBe(false)
    expect(keywordAllowed('where', 'ON')).toBe(false)
  })

  it('restricts VALUES, SET, and INTO to their statements', () => {
    expect(keywordAllowed('insert-into', 'VALUES')).toBe(true)
    expect(keywordAllowed('where', 'VALUES')).toBe(false)
    expect(keywordAllowed('update', 'SET')).toBe(true)
    expect(keywordAllowed('from', 'SET')).toBe(false)
    expect(keywordAllowed('insert-into', 'INTO')).toBe(true)
    expect(keywordAllowed('order-by', 'INTO')).toBe(false)
  })

  it('leaves unrelated keywords visible', () => {
    expect(keywordAllowed('select', 'COUNT')).toBe(true)
    expect(keywordAllowed('from', 'SELECT')).toBe(true)
    expect(keywordAllowed('where', 'CASE')).toBe(true)
  })
})
