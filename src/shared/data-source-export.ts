// 导出（docs/prd/database.md「导出」）：CSV / JSON / SQL INSERT 逐行生成，边读边写文件。
// 值都是数据库给的原样文字：数字列在 JSON 与 SQL 里原样写成数字（大整数、高精度小数不失真），二进制写成十六进制。

import Papa from 'papaparse'
import {
  quoteIdent,
  type ResultColumn,
  type ResultValue,
  type SqlDialect
} from './data-source-query'

/** 导出格式；取值即文件扩展名。 */
export type ExportFormat = 'csv' | 'json' | 'sql'

export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'sql']

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  sql: 'SQL INSERT 语句'
}

/** 控制台结果不知道来自哪张表，SQL INSERT 里先写成这个表名。 */
export const CONSOLE_EXPORT_TABLE = 'result'

/**
 * SQL INSERT 写进哪张表：table 为目标表名（已按方言引用好的完整表名）；generated 为这张表的生成列，值由数据库算出、
 * 插入时不能给，INSERT 的列清单与值里都不写，导出的语句才能导回同结构的表；alwaysIdentity 为 PostgreSQL 总是自动生成
 * 的标识列（GENERATED ALWAYS AS IDENTITY），写了其中的列时 INSERT 里加 OVERRIDING SYSTEM VALUE（同 pg_dump
 * --inserts），照原来的值导回。控制台、运行会话的结果不知道来自哪张表，两者都为空，各列照原样写。
 */
export interface InsertTarget {
  table: string
  generated: readonly string[]
  alwaysIdentity: readonly string[]
}

/** 文件名里不能用的字符：路径分隔符、Windows 不允许的 <>:"|?* 与控制字符 */
const UNSAFE_FILE_NAME_CHARS = /[/\\<>:"|?*\p{Cc}]/gu

/**
 * Windows 的保留设备名（不分大小写；Windows 把上标 ¹²³ 也当数字）：单独作文件名、或紧跟扩展名（NUL.txt、
 * NUL.tar.gz）都等同于设备本身。见微软文档 Naming Files, Paths, and Namespaces。
 */
const WINDOWS_RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?=\.|$)/i

/**
 * 保存对话框的默认文件名：`name`（表名）可能带路径分隔符或 Windows 不能用的字符，这些替换成 `_`；
 * 是 Windows 保留设备名时在它后面加 `_`，保证是单个合法文件名。处理后为空时用 CONSOLE_EXPORT_TABLE。
 */
export function exportFileName(name: string, format: ExportFormat): string {
  const safe = name
    .replace(UNSAFE_FILE_NAME_CHARS, '_')
    .trim()
    .replace(WINDOWS_RESERVED_NAME, '$&_')
  return `${safe === '' ? CONSOLE_EXPORT_TABLE : safe}.${format}`
}

/** 逐行输出：先写 head，每行写 row() 的返回，最后写 tail。 */
export interface ExportWriter {
  head: string
  row: (values: ResultValue[]) => string
  tail: string
}

/** JSON 与 SQL 都认的数字写法（数据库给的 NaN、Infinity 这类不是）。 */
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

const TRUE_TEXTS = new Set(['t', 'true'])
const FALSE_TEXTS = new Set(['f', 'false'])

/**
 * 一格写成表格文字（CSV 与复制成 TSV 共用）：NULL 为空格子（贴进表格软件即空单元格），二进制写成 0x 开头的十六进制，
 * 其余原样。
 */
export function resultValueText(value: ResultValue): string {
  if (value === null) return ''
  return typeof value === 'string' ? value : `0x${value.hex}`
}

function jsonValue(value: ResultValue, column: ResultColumn): string {
  if (value === null) return 'null'
  if (typeof value !== 'string') return JSON.stringify(`0x${value.hex}`)
  if (column.type === 'number' && NUMERIC.test(value)) return value
  if (column.type === 'boolean') {
    if (TRUE_TEXTS.has(value)) return 'true'
    if (FALSE_TEXTS.has(value)) return 'false'
  }
  return JSON.stringify(value)
}

/** 字符串常量：PostgreSQL 与 SQLite 只把单引号写两遍；MySQL 默认还把反斜杠当转义符，也要写两遍。 */
function sqlString(dialect: SqlDialect, text: string): string {
  const escaped = dialect === 'mysql' ? text.replace(/\\/g, '\\\\') : text
  return `'${escaped.replace(/'/g, "''")}'`
}

function sqlValue(dialect: SqlDialect, value: ResultValue, column: ResultColumn): string {
  if (value === null) return 'NULL'
  if (typeof value !== 'string') {
    return dialect === 'postgresql' ? `'\\x${value.hex}'::bytea` : `X'${value.hex.toUpperCase()}'`
  }
  if (column.type === 'number' && NUMERIC.test(value)) return value
  if (column.type === 'boolean') {
    if (TRUE_TEXTS.has(value)) return 'TRUE'
    if (FALSE_TEXTS.has(value)) return 'FALSE'
  }
  return sqlString(dialect, value)
}

/**
 * 某种格式的逐行输出。target 为 SQL INSERT 写进哪张表（生成列只在 SQL INSERT 里不写，CSV、JSON 照旧全写）。
 * CSV 开头写 UTF-8 BOM（Excel 靠它认出中文），按 RFC 4180 用 CRLF 换行。
 */
export function exportWriter(
  format: ExportFormat,
  dialect: SqlDialect,
  columns: ResultColumn[],
  target: InsertTarget
): ExportWriter {
  switch (format) {
    case 'csv': {
      const line = (cells: string[]): string => `${Papa.unparse([cells], { newline: '\r\n' })}\r\n`
      return {
        head: `\uFEFF${line(columns.map((c) => c.name))}`,
        row: (values) => line(values.map(resultValueText)),
        tail: ''
      }
    }
    case 'json': {
      let first = true
      return {
        head: '[',
        row: (values) => {
          const fields = columns.map(
            (column, i) => `${JSON.stringify(column.name)}: ${jsonValue(values[i] ?? null, column)}`
          )
          const prefix = first ? '\n  ' : ',\n  '
          first = false
          return `${prefix}{ ${fields.join(', ')} }`
        },
        get tail() {
          return first ? ']\n' : '\n]\n'
        }
      }
    }
    case 'sql': {
      const generated = new Set(target.generated)
      // 要写的列与它在一行里的位置
      const written = columns.flatMap((column, i) =>
        generated.has(column.name) ? [] : [{ column, i }]
      )
      const names = written.map(({ column }) => quoteIdent(dialect, column.name)).join(', ')
      // PostgreSQL 给总是自动生成的标识列写值，不加这一句会报错
      const alwaysIdentity = new Set(target.alwaysIdentity)
      const overriding = written.some(({ column }) => alwaysIdentity.has(column.name))
        ? ' OVERRIDING SYSTEM VALUE'
        : ''
      return {
        head: '',
        row: (values) =>
          `INSERT INTO ${target.table} (${names})${overriding} VALUES (${written
            .map(({ column, i }) => sqlValue(dialect, values[i] ?? null, column))
            .join(', ')});\n`,
        tail: ''
      }
    }
  }
}
