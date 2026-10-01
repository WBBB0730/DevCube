// 补全数据的整理（docs/prd/database.md「补全」）：把读表结构的各条查询（见 data-source-catalog 的 readCompletionSchema）
// 按位置取到的文字整理成补全引擎要的形状（shared/data-source-query 的 CompletionSchema，对应 pgcli 各 extend_* 的输入）。
// 布尔值各数据库写法不同（PostgreSQL 为 t / f，MySQL / MariaDB 与 SQLite 为 1 / 0），这里统一认。

import { searchPathItemName, searchPathItems } from '../shared/data-source-context'
import type {
  CompletionForeignKey,
  CompletionFunction,
  CompletionNamespace,
  CompletionRelation,
  CompletionSchema
} from '../shared/data-source-query'

/** 一行查询结果：按位置取的各列文字，NULL 为 null。 */
export type Cells = readonly (string | null)[]

/** 查询里的布尔值：PostgreSQL 为 t / f，MySQL / MariaDB 与 SQLite 为 1 / 0。 */
function truthy(value: string | null | undefined): boolean {
  return value === 't' || value === 'true' || value === '1'
}

/** 读到的各部分（行的各列次序见各项）。 */
export interface CompletionRows {
  /** 库 */
  databases: string[]
  /** 模式（MySQL / MariaDB 为库，SQLite 为 main）：没有对象的也列 */
  schemas: string[]
  /**
   * 表与视图的各列，按模式、表、列的次序：模式、表、是否视图、列名、类型、有无默认值、默认值。没有列的表列名为 null
   * （PostgreSQL 可以建没有列的表）
   */
  columns: readonly Cells[]
  /** 函数：所在的模式与函数（见 pgFunctionOf、mysqlRoutinesOf） */
  functions: readonly [string, CompletionFunction][]
  /** 自定义类型：模式、类型名 */
  datatypes: readonly Cells[]
  /** 存储过程（MySQL / MariaDB）：所在的库与过程名；不给即没有这一项（其余类型的过程在函数里） */
  procedures?: readonly [string, string][]
  /** 外键的各列：父表的模式、表、列，子表的模式、表、列（同 pgcli 的 foreignkeys 查询） */
  foreignKeys: readonly Cells[]
  searchPath: string[]
}

/** 整理成补全引擎要的形状：各模式按读到的次序，其中的表、视图、函数、类型、过程各按查询的次序。 */
export function buildCompletionSchema(rows: CompletionRows): CompletionSchema {
  const namespaces = new Map<string, CompletionNamespace>()
  const namespaceOf = (name: string): CompletionNamespace => {
    let namespace = namespaces.get(name)
    if (namespace === undefined) {
      namespace = {
        name,
        tables: [],
        views: [],
        functions: [],
        datatypes: [],
        ...(rows.procedures === undefined ? {} : { procedures: [] })
      }
      namespaces.set(name, namespace)
    }
    return namespace
  }
  for (const name of rows.schemas) namespaceOf(name)

  const relations = new Map<string, CompletionRelation>()
  for (const [schema, name, isView, column, datatype, hasDefault, defaultValue] of rows.columns) {
    if (schema == null || name == null) continue
    const key = `${schema}\0${name}`
    let relation = relations.get(key)
    if (relation === undefined) {
      relation = { name, columns: [] }
      relations.set(key, relation)
      namespaceOf(schema)[truthy(isView) ? 'views' : 'tables'].push(relation)
    }
    if (column == null) continue
    relation.columns.push({
      name: column,
      datatype: datatype ?? null,
      default: defaultValue ?? null,
      hasDefault: truthy(hasDefault)
    })
  }

  for (const [schema, func] of rows.functions) namespaceOf(schema).functions.push(func)
  for (const [schema, name] of rows.datatypes) {
    if (schema != null && name != null) namespaceOf(schema).datatypes.push(name)
  }
  for (const [schema, name] of rows.procedures ?? []) {
    const procedures = namespaceOf(schema).procedures!
    if (!procedures.includes(name)) procedures.push(name)
  }

  const foreignKeys = rows.foreignKeys.flatMap((cells): CompletionForeignKey[] => {
    const [parentschema, parenttable, parentcolumn, childschema, childtable, childcolumn] = cells
    if (
      parentschema == null ||
      parenttable == null ||
      parentcolumn == null ||
      childschema == null ||
      childtable == null ||
      childcolumn == null
    ) {
      return []
    }
    return [{ parentschema, parenttable, parentcolumn, childschema, childtable, childcolumn }]
  })

  return {
    databases: rows.databases,
    schemas: [...namespaces.values()],
    searchPath: rows.searchPath,
    foreignKeys
  }
}

/** JSON 写的文字数组（PostgreSQL 的 to_json(数组)）；NULL、不是数组为 null。 */
function jsonStrings(value: string | null | undefined): string[] | null {
  if (value == null) return null
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed.map((item) => String(item ?? '')) : null
}

/**
 * PostgreSQL 的一个函数（pgcli 的 functions 查询）：模式、函数名、to_json 的参数名 / 参数类型 / 参数模式、返回类型、
 * 是否聚合、是否窗口函数、是否返回结果集、是否扩展带来的、参数默认值。
 */
export function pgFunctionOf(cells: Cells): [string, CompletionFunction] {
  const [schema, name, argNames, argTypes, argModes, returnType, agg, win, setof, ext, defaults] =
    cells
  return [
    schema ?? '',
    {
      funcName: name ?? '',
      argNames: jsonStrings(argNames),
      argTypes: jsonStrings(argTypes),
      argModes: jsonStrings(argModes),
      returnType: returnType ?? '',
      isAggregate: truthy(agg),
      isWindow: truthy(win),
      isSetReturning: truthy(setof),
      isExtension: truthy(ext),
      argDefaults: defaults ?? null
    }
  ]
}

/**
 * MySQL / MariaDB 的存储函数与存储过程（information_schema.routines 连同 parameters，每个参数一行，按参数的次序）：
 * 库、名字、类别（FUNCTION / PROCEDURE）、返回类型、参数名、参数类型；没有参数的只有一行，参数两项为 null。函数的
 * 参数都是入参，没有默认值；过程只要名字（CALL 之后补全）。
 */
export function mysqlRoutinesOf(rows: readonly Cells[]): {
  functions: [string, CompletionFunction][]
  procedures: [string, string][]
} {
  const functions = new Map<string, [string, CompletionFunction]>()
  const procedures: [string, string][] = []
  for (const [schema, name, type, returnType, argName, argType] of rows) {
    if (schema == null || name == null) continue
    if (type === 'PROCEDURE') {
      procedures.push([schema, name])
      continue
    }
    const key = `${schema}\0${name}`
    let entry = functions.get(key)
    if (entry === undefined) {
      entry = [
        schema,
        {
          funcName: name,
          argNames: null,
          argTypes: null,
          argModes: null,
          returnType: returnType ?? '',
          isAggregate: false,
          isWindow: false,
          isSetReturning: false,
          isExtension: false,
          argDefaults: null
        }
      ]
      functions.set(key, entry)
    }
    if (argName == null) continue
    const func = entry[1]
    func.argNames = [...(func.argNames ?? []), argName]
    func.argTypes = [...(func.argTypes ?? []), argType ?? '']
  }
  return { functions: [...functions.values()], procedures }
}

/**
 * MySQL / MariaDB 的 SHOW 之后的项目（mycli sqlexecute.py 的 show_candidates）：帮助表里以 SHOW 开头的主题（如
 * `SHOW CREATE TABLE`）去掉第一个词（`name.split(None, 1)[-1]`，只有一个词的留它自己）。
 */
export function mysqlShowItemsOf(rows: readonly Cells[]): string[] {
  return rows.flatMap(([name]) => {
    const words = name?.trimStart()
    if (!words) return []
    const space = words.search(/\s/)
    const rest = space < 0 ? '' : words.slice(space).trimStart()
    return [rest === '' ? words.trimEnd() : rest]
  })
}

/**
 * PostgreSQL 新连接上不写前缀时查找的模式（缓存里存这份：运行配置在新连接上跑）：由会话开始时的 search_path（resetVal，
 * 不随 SET 改变）算出，"$user" 换成登录的用户 user，没写 pg_catalog 时它隐含在最前（同 consoleSearchPath，不存在的
 * 模式不去掉：补全时自然查不到）。
 */
export function pgDefaultSearchPath(resetVal: string, user: string): string[] {
  const names = searchPathItems(resetVal)
    .map(searchPathItemName)
    .map((name) => (name === '$user' ? user : name))
  const path = [...new Set(names)]
  return path.includes('pg_catalog') ? path : ['pg_catalog', ...path]
}

/**
 * SQLite 的外键（pragma_foreign_key_list，模式都是 main）：子表、子表的列、父表、父表的列（没写即父表的主键）、在外键
 * 里的第几列（从 0 起）；primaryKeys 为各表的主键列（按在主键里的次序），补上没写的父表列。补不上的不要。整理成
 * buildCompletionSchema 的外键行。
 */
export function sqliteForeignKeysOf(
  rows: readonly Cells[],
  primaryKeys: readonly Cells[]
): Cells[] {
  const keys = new Map<string, string[]>()
  for (const [table, column] of primaryKeys) {
    if (table == null || column == null) continue
    keys.set(table, [...(keys.get(table) ?? []), column])
  }
  return rows.flatMap(([child, from, parent, to, seq]): Cells[] => {
    if (child == null || from == null || parent == null) return []
    const parentColumn = to ?? keys.get(parent)?.[Number(seq)]
    return parentColumn === undefined ? [] : [['main', parent, parentColumn, 'main', child, from]]
  })
}
