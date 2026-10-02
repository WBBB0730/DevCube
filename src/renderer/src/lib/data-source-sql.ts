// 数据源的 SQL 方言：CodeMirror 的高亮与补全、sql-formatter 的格式化（docs/prd/database.md「编辑与执行」）。
// 格式化控制台与运行配置对话框共用（formatSql），认得运行配置的参数 `${{…}}`。
import { MariaSQL, MySQL, PostgreSQL, SQLDialect, SQLite } from '@codemirror/lang-sql'
import type { EditorView } from '@codemirror/view'
import {
  formatDialect,
  mariadb,
  mysql,
  postgresql,
  sqlite,
  type DialectOptions
} from 'sql-formatter'
import type { SqlKind } from '@shared/data-source'
import { RUN_PARAM_SOURCE } from '@shared/run-params'

/**
 * lang-sql 自带的 MySQL / MariaDB 方言与服务器不符的两处，照它的 spec 另定义一份改上，高亮、切语句、补全切词才与
 * 服务器一致：
 * - MySQL / MariaDB 默认把字符串里的反斜杠当转义符（`'\''` 是一个引号；导出的 SQL INSERT 也这样写），开上
 *   backslashEscapes；
 * - 可执行注释（以 `/*!` 开头，MariaDB 另有 `/*M!`）照 mysql 客户端找结尾（versionComments，lang-sql 补丁加的
 *   选项，见 patches/）：里面的字符串、带引号的名字与注释照常认，其中的注释结尾符不算结尾。
 */
const MYSQL = SQLDialect.define({ ...MySQL.spec, backslashEscapes: true, versionComments: 'mysql' })
const MARIADB = SQLDialect.define({
  ...MariaSQL.spec,
  backslashEscapes: true,
  versionComments: 'mariadb'
})

export function codemirrorDialect(kind: SqlKind): SQLDialect {
  switch (kind) {
    case 'postgresql':
      return PostgreSQL
    case 'mysql':
      return MYSQL
    case 'mariadb':
      return MARIADB
    case 'sqlite':
      return SQLite
  }
}

/** 只引入用到的四种方言（formatDialect 按需打包，比整包的 format 轻）。 */
function formatterDialect(kind: SqlKind): DialectOptions {
  switch (kind) {
    case 'postgresql':
      return postgresql
    case 'mysql':
      return mysql
    case 'mariadb':
      return mariadb
    case 'sqlite':
      return sqlite
  }
}

/**
 * 按方言格式化 SQL；格式化不了（语句写得不对）时抛出。运行配置的参数 `${{…}}` 认作一个参数、原样保留（sql-formatter
 * 默认遇到它会报错）：只加这一种自定义参数，方言自带的参数写法（`$1`、`?`、`:名称` 等）照旧。
 */
export function formatSql(text: string, kind: SqlKind): string {
  return formatDialect(text, {
    dialect: formatterDialect(kind),
    paramTypes: { custom: [{ regex: RUN_PARAM_SOURCE }] }
  })
}

/** 格式化编辑器里选中的部分（没选中为全部）。格式化不了时不改，交回原因；否则为 null。 */
export function formatSqlInEditor(view: EditorView, kind: SqlKind): string | null {
  const { from, to } = view.state.selection.main
  const range = from === to ? { from: 0, to: view.state.doc.length } : { from, to }
  try {
    const formatted = formatSql(view.state.sliceDoc(range.from, range.to), kind)
    view.dispatch({ changes: { ...range, insert: formatted } })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
