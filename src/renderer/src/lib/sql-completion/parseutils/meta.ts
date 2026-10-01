// 移植 pgcli/packages/parseutils/meta.py：列、外键、表与函数的元数据。
import type { CompletionForeignKey, CompletionFunction } from '@shared/data-source-query'
import type { TableReference } from './tables'

/** meta.py: ForeignKey（即表结构里的外键） */
export type ForeignKey = CompletionForeignKey

/** meta.py: ColumnMetadata */
export interface ColumnMetadata {
  name: string
  datatype: string | null
  foreignkeys: ForeignKey[]
  default: string | null
  hasDefault: boolean
}

/** meta.py: ColumnMetadata（工厂函数，外键默认为空） */
export function columnMetadata(
  name: string,
  datatype: string | null,
  foreignkeys: ForeignKey[] = [],
  defaultValue: string | null = null,
  hasDefault = false
): ColumnMetadata {
  return { name, datatype, foreignkeys, default: defaultValue, hasDefault }
}

/**
 * meta.py: TableMetadata——语句里自带的表（CTE，以及子查询作用域里带别名的子查询）。starTables 为 sqls 的
 * SubQueryColumn「*」：子查询 SELECT * / t.* 时列取自这些表，补全时按表结构展开。
 */
export interface TableMetadata {
  name: string
  columns: ColumnMetadata[]
  starTables?: TableReference[]
}

/** meta.py: parse_defaults——pg_get_expr(proargdefaults) 给出的各参数默认值。 */
export function* parseDefaults(defaultsString: string | null): Generator<string> {
  if (!defaultsString) return
  let current = ''
  let inQuote: string | null = null
  for (const char of defaultsString) {
    if (current === '' && char === ' ') continue
    if (char === '"' || char === "'") {
      if (inQuote && char === inQuote) inQuote = null
      else if (!inQuote) inQuote = char
    } else if (char === ',' && !inQuote) {
      yield current
      current = ''
      continue
    }
    current += char
  }
  yield current
}

/** FunctionMetadata 的构造参数（meta.py: FunctionMetadata.__init__）：表结构里的函数与它所在的模式。 */
export interface FunctionMetadataInit extends CompletionFunction {
  schemaName: string
}

/** meta.py: FunctionMetadata */
export class FunctionMetadata {
  readonly schemaName: string
  readonly funcName: string
  readonly argModes: readonly string[] | null
  readonly argNames: readonly string[] | null
  readonly argTypes: readonly (string | null)[] | null
  readonly argDefaults: readonly string[]
  readonly returnType: string
  readonly isAggregate: boolean
  readonly isWindow: boolean
  readonly isSetReturning: boolean
  readonly isExtension: boolean
  readonly isPublic: boolean

  constructor(init: FunctionMetadataInit) {
    this.schemaName = init.schemaName
    this.funcName = init.funcName
    this.argModes = init.argModes && init.argModes.length > 0 ? init.argModes : null
    this.argNames = init.argNames && init.argNames.length > 0 ? init.argNames : null
    // 老版本 PostgreSQL 取不到参数类型时，每个参数以 null 占位
    if (init.argTypes && init.argTypes.length > 0) this.argTypes = init.argTypes
    else if (this.argModes) this.argTypes = this.argModes.map(() => null)
    else if (this.argNames) this.argTypes = this.argNames.map(() => null)
    else this.argTypes = null
    this.argDefaults = [...parseDefaults(init.argDefaults)]
    this.returnType = init.returnType.trim()
    this.isAggregate = init.isAggregate
    this.isWindow = init.isWindow
    this.isSetReturning = init.isSetReturning
    this.isExtension = init.isExtension
    this.isPublic = Boolean(this.schemaName) && this.schemaName === 'public'
  }

  /** meta.py: FunctionMetadata.has_variadic */
  hasVariadic(): boolean {
    return this.argModes !== null && this.argModes.includes('v')
  }

  /** meta.py: FunctionMetadata.args——入参（IN、INOUT、VARIADIC）。 */
  args(): ColumnMetadata[] {
    if (!this.argNames) return []
    const modes = this.argModes ?? this.argNames.map(() => 'i')
    const args: [string, string | null][] = []
    this.argNames.forEach((name, i) => {
      if (['i', 'b', 'v'].includes(modes[i]!)) args.push([name, this.argTypes?.[i] ?? null])
    })
    const numArgs = args.length
    const numDefaults = this.argDefaults.length
    return args.map(([name, typ], num) => {
      const hasDefault = num + numDefaults >= numArgs
      const def = hasDefault ? this.argDefaults[num - numArgs + numDefaults]! : null
      return columnMetadata(name, typ, [], def, hasDefault)
    })
  }

  /** meta.py: FunctionMetadata.fields——出参（OUT、INOUT、TABLE）。 */
  fields(): ColumnMetadata[] {
    if (this.returnType.toLowerCase() === 'void') return []
    // 没有出参的函数以函数名为结果列名（如 SELECT unnest FROM unnest(...)）
    if (!this.argModes) return [columnMetadata(this.funcName, this.returnType, [])]
    const out: ColumnMetadata[] = []
    this.argModes.forEach((mode, i) => {
      if (['o', 'b', 't'].includes(mode)) {
        out.push(columnMetadata(this.argNames?.[i] ?? '', this.argTypes?.[i] ?? null, []))
      }
    })
    return out
  }
}
