// 补全的匹配与排序：移植 pgcli/pgcompleter.py（PGCompleter）。按 suggest_type 给出的建议类型从表结构取候选，再按
// 输入模糊匹配、排序。各方言共用 pgcli 的匹配与排序；名字的引号、内置函数 / 关键字 / 类型照各自的来源（见
// dialects.ts）；mycli 独有的建议类型（枚举值、字符集、排序规则、字符集引导符、SHOW、用户、CHANGE MASTER TO、
// 存储过程）照 mycli/sqlcompleter.py 的 get_completions。
// 没有移植的：命令行专用的补全（特殊命令、表格式、命名查询、文件路径）；casing_file（大小写偏好改由 settings.casing
// 直接给出）；参数样式的配置项（signature / call 样式固定为 pgcli 的默认值）。
import type { SqlKind } from '@shared/data-source'
import type { CompletionColumn, CompletionSchema } from '@shared/data-source-query'
import { completionDialect, type Dialect } from './dialects'
import {
  columnMetadata,
  FunctionMetadata,
  type ColumnMetadata,
  type ForeignKey,
  type TableMetadata
} from './parseutils/meta'
import { isLower, tableReference, tableRef, type TableReference } from './parseutils/tables'
import { escapeRegex, lastWord } from './parseutils/utils'
import { keywordAllowed, sqlClauseAt } from './keyword-clauses'
import { PrevalenceCounter } from './prioritization'
import { suggestType, type Suggestion } from './sqlcompletion'

// 输入的表结构即 shared 的 CompletionSchema（主进程读出，对应 pgcli 各 extend_* 的输入）。

export interface CompleterSettings {
  /** pgcli qualify_columns：列名前是否带表名（或别名） */
  qualifyColumns: 'always' | 'never' | 'if_more_than_one_table'
  /** pgcli generate_aliases：FROM / JOIN 里补表名时自动带别名 */
  generateAliases: boolean
  /** pgcli search_path_filter：不写模式时只补 search_path 里的对象 */
  searchPathFilter: boolean
  /**
   * keyword_casing：默认照各自的来源——pgcli 为 upper，mycli / litecli 为 auto（按输入的最后一个字母的大小写）
   */
  keywordCasing: 'upper' | 'lower' | 'auto'
  /** pgcli asterisk_column_order：* 展开的列顺序 */
  asteriskColumnOrder: 'table_order' | 'alphabetic'
  /** pgcli alias_map：表名 → 预设的别名 */
  aliasMap: Readonly<Record<string, string>> | null
  /** pgcli 的 casing：名字偏好的大小写写法（extend_casing） */
  casing: readonly string[]
  /** pgcli insert_col_skip_patterns：INSERT 里展开 * 时跳过默认值匹配这些模式的列 */
  insertColSkipPatterns: readonly RegExp[]
}

/** pgcli 的默认设置（keywordCasing 另按方言，见 CompleterSettings.keywordCasing）。 */
export const DEFAULT_SETTINGS: CompleterSettings = {
  qualifyColumns: 'if_more_than_one_table',
  generateAliases: false,
  searchPathFilter: false,
  keywordCasing: 'upper',
  asteriskColumnOrder: 'table_order',
  aliasMap: null,
  casing: [],
  insertColSkipPatterns: [/^now\(\)$/, /^nextval\(/]
}

/** pgcli 的 call_arg_oneliner_max 默认值：参数多于这个数时每个参数单占一行。 */
const CALL_ARG_ONELINER_MAX = 2

/**
 * 一条补全：插入的文字、从光标往前替换的长度（负数）、显示的文字与说明（前四项同 pgcli 的 prompt_toolkit
 * Completion）。datatype 为列的类型（pgcli 不显示，这里给界面用），只在列的补全、且类型已知时有。
 */
export interface Completion {
  text: string
  startPosition: number
  display: string
  displayMeta: string | null
  datatype?: string
}

// —— 候选与排序 ——

type PriorityItem = number | string | PriorityItem[]
export type Priority = PriorityItem[]

export interface Match {
  completion: Completion
  priority: Priority
}

/** pgcompleter.py: Candidate（另带列的类型，见 Completion.datatype） */
interface Candidate {
  completion: string
  prio: number
  meta: string | null
  synonyms: string[]
  prio2: number
  display: string
  datatype: string | null
}

function candidate(
  completion: string,
  {
    prio = 0,
    meta = null,
    synonyms,
    prio2 = 0,
    display,
    datatype = null
  }: {
    prio?: number
    meta?: string | null
    synonyms?: string[]
    prio2?: number
    display?: string
    datatype?: string | null
  } = {}
): Candidate {
  return {
    completion,
    prio,
    meta,
    synonyms: synonyms ?? [completion],
    prio2,
    display: display ?? completion,
    datatype
  }
}

/** pgcompleter.py: SchemaObject */
interface SchemaObject {
  name: string
  schema: string | null
  meta: FunctionMetadata | null
}

/** Python 元组的比较（逐项；数字按大小、字符串按码点、元组递归）。 */
export function comparePriority(a: PriorityItem, b: PriorityItem): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = comparePriority(a[i]!, b[i]!)
      if (c !== 0) return c
    }
    return a.length - b.length
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
  if (typeof a === 'string' && typeof b === 'string') return a === b ? 0 : a < b ? -1 : 1
  return 0
}

const maxPriority = (items: PriorityItem[][]): PriorityItem[] =>
  items.reduce((best, item) => (comparePriority(item, best) > 0 ? item : best))

/** find_matches 里按类型排序的先后（后面的优先） */
const PRIO_ORDER = [
  'keyword',
  'function',
  'view',
  'table',
  'datatype',
  'database',
  'schema',
  'column',
  'table alias',
  'join',
  'name join',
  'fk join',
  'table format'
]

/** Python 的 str.isupper（单个字符） */
const isUpperChar = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()

/**
 * pgcompleter.py: generate_alias——表的别名：预设的，否则表名里的大写字母，否则首字母与每个下划线后的字母。
 */
export function generateAlias(
  tbl: string,
  aliasMap: Readonly<Record<string, string>> | null = null
): string {
  if (aliasMap && tbl in aliasMap) return aliasMap[tbl]!
  const chars = [...tbl]
  const upper = chars.filter(isUpperChar)
  if (upper.length > 0) return upper.join('')
  return chars.filter((l, i) => (i === 0 ? true : chars[i - 1] === '_') && l !== '_').join('')
}

/** mycli sqlexecute.py: _parse_enum_values——COLUMN_TYPE 为 enum(…) 时的各个取值。 */
export function parseEnumValues(columnType: string | null): string[] {
  if (!columnType || !columnType.toLowerCase().startsWith('enum(')) return []
  const values: string[] = []
  let current: string[] = []
  let inQuote = false
  for (let i = columnType.indexOf('(') + 1; i < columnType.length; i++) {
    const ch = columnType[i]!
    if (!inQuote) {
      if (ch === "'") {
        inQuote = true
        current = []
      } else if (ch === ')') {
        break
      }
    } else if (ch === '\\' && i + 1 < columnType.length) {
      current.push(columnType[i + 1]!)
      i += 1
    } else if (ch === "'") {
      if (columnType[i + 1] === "'") {
        current.push("'")
        i += 1
      } else {
        values.push(current.join(''))
        inQuote = false
      }
    } else {
      current.push(ch)
    }
  }
  return values
}

type Kind = 'tables' | 'views' | 'functions' | 'datatypes'

/** pgcompleter.py: PGCompleter */
export class SqlCompleter {
  readonly dialect: Dialect
  readonly settings: CompleterSettings
  private readonly prioritizer: PrevalenceCounter
  private readonly databases: string[] = []
  private readonly dbmetadata: {
    tables: Map<string, Map<string, Map<string, ColumnMetadata>>>
    views: Map<string, Map<string, Map<string, ColumnMetadata>>>
    functions: Map<string, Map<string, FunctionMetadata[]>>
    datatypes: Map<string, Map<string, null>>
  } = { tables: new Map(), views: new Map(), functions: new Map(), datatypes: new Map() }
  private readonly procedures = new Map<string, string[]>()
  private searchPath: string[] = []
  private casing = new Map<string, string>()
  private readonly functionNames: ReadonlySet<string>
  private argListCache = new Map<
    FunctionMetadata,
    Record<'call' | 'call_display' | 'signature', string>
  >()
  private readonly mysqlData: Required<
    Pick<CompletionSchema, 'characterSets' | 'collations' | 'showItems' | 'users'>
  >

  /**
   * prioritizer 为使用次数的计数器：pgcli 重建补全器（表结构变了）时沿用原来的（main.py: _swap_completer_objects），这里
   * 由调用方给出同一个；不给即新建一个。
   */
  constructor(
    kind: SqlKind,
    metadata: CompletionSchema,
    settings: Partial<CompleterSettings> = {},
    prioritizer: PrevalenceCounter = new PrevalenceCounter()
  ) {
    this.dialect = completionDialect(kind)
    this.settings = {
      ...DEFAULT_SETTINGS,
      keywordCasing: this.dialect.family === 'postgresql' ? 'upper' : 'auto',
      ...settings
    }
    this.prioritizer = prioritizer
    this.functionNames = new Set(this.dialect.functions.map((f) => f.toUpperCase()))
    this.mysqlData = {
      characterSets: metadata.characterSets ?? [],
      collations: metadata.collations ?? [],
      showItems: metadata.showItems ?? [],
      users: metadata.users ?? []
    }
    // 次序同 pgcli 测试里构造补全器（tests/metadata.py: MetaData.get_completer）
    this.extendSchemata(metadata.schemas.map((s) => s.name))
    for (const kindName of ['tables', 'views'] as const) {
      this.extendRelations(
        metadata.schemas.flatMap((s) => s[kindName].map((r): [string, string] => [s.name, r.name])),
        kindName
      )
    }
    for (const kindName of ['tables', 'views'] as const) {
      this.extendColumns(
        metadata.schemas.flatMap((s) =>
          s[kindName].flatMap((r) =>
            r.columns.map((c): [string, string, CompletionColumn] => [s.name, r.name, c])
          )
        ),
        kindName
      )
    }
    this.extendFunctions(
      metadata.schemas.flatMap((s) =>
        s.functions.map((f) => new FunctionMetadata({ ...f, schemaName: s.name }))
      )
    )
    this.extendDatatypes(
      metadata.schemas.flatMap((s) => s.datatypes.map((d): [string, string] => [s.name, d]))
    )
    this.extendForeignkeys(metadata.foreignKeys)
    this.setSearchPath(metadata.searchPath)
    // extend_database_names：pgcli / litecli 存原名；mycli 转义（USE 之后给 `test 2`）
    this.databases.push(
      ...(this.dialect.family === 'mysql'
        ? this.escapedNames(metadata.databases)
        : metadata.databases)
    )
    this.extendCasing(this.settings.casing)
    for (const s of metadata.schemas) {
      if (s.procedures) this.procedures.set(this.escapeName(s.name), s.procedures)
    }
  }

  // —— 名字的引号 ——

  /** pgcompleter.py: PGCompleter.escape_name（mycli / litecli 用反引号） */
  escapeName(name: string): string {
    const upper = name.toUpperCase()
    if (
      name &&
      (!this.dialect.namePattern.test(name) ||
        this.dialect.quoteWords.has(upper) ||
        this.functionNames.has(upper))
    ) {
      return `${this.dialect.quote}${name}${this.dialect.quote}`
    }
    return name
  }

  /** pgcompleter.py: PGCompleter.escape_schema */
  private escapeSchema(name: string): string {
    return `'${this.unescapeName(name)}'`
  }

  /** pgcompleter.py: PGCompleter.unescape_name */
  unescapeName(name: string): string {
    const q = this.dialect.quote
    return name && name[0] === q && name[name.length - 1] === q ? name.slice(1, -1) : name
  }

  private escapedNames(names: string[]): string[] {
    return names.map((n) => this.escapeName(n))
  }

  /** pgcompleter.py: normalize_ref */
  private normalizeRef(ref: string): string {
    const q = this.dialect.quote
    return ref[0] === q ? ref : q + ref.toLowerCase() + q
  }

  // —— 表结构（pgcompleter.py: PGCompleter.extend_*） ——

  private extendSchemata(schemata: string[]): void {
    for (const schema of this.escapedNames(schemata)) {
      for (const kind of ['tables', 'views', 'functions', 'datatypes'] as const) {
        if (!this.dbmetadata[kind].has(schema)) this.dbmetadata[kind].set(schema, new Map())
      }
    }
  }

  private extendRelations(data: [string, string][], kind: 'tables' | 'views'): void {
    const metadata = this.dbmetadata[kind]
    for (const [schema, relname] of data.map((d) => this.escapedNames(d))) {
      metadata.get(schema!)?.set(relname!, new Map())
    }
  }

  private extendColumns(
    columnData: [string, string, CompletionColumn][],
    kind: 'tables' | 'views'
  ): void {
    const metadata = this.dbmetadata[kind]
    for (const [rawSchema, rawRel, col] of columnData) {
      const [schema, relname, colname] = this.escapedNames([rawSchema, rawRel, col.name])
      if (!metadata.has(schema!)) metadata.set(schema!, new Map())
      const rels = metadata.get(schema!)!
      if (!rels.has(relname!)) rels.set(relname!, new Map())
      rels
        .get(relname!)!
        .set(
          colname!,
          columnMetadata(colname!, col.datatype, [], col.default ?? null, col.hasDefault ?? false)
        )
    }
  }

  private extendFunctions(funcData: FunctionMetadata[]): void {
    const metadata = this.dbmetadata.functions
    for (const f of funcData) {
      const [schema, func] = this.escapedNames([f.schemaName, f.funcName])
      if (!metadata.has(schema!)) metadata.set(schema!, new Map())
      const funcs = metadata.get(schema!)!
      funcs.set(func!, [...(funcs.get(func!) ?? []), f])
    }
    this.refreshArgListCache()
  }

  /** pgcompleter.py: PGCompleter._refresh_arg_list_cache */
  private refreshArgListCache(): void {
    this.argListCache = new Map()
    for (const funcs of this.dbmetadata.functions.values()) {
      for (const metas of funcs.values()) {
        for (const meta of metas) {
          this.argListCache.set(meta, {
            call: this.argList(meta, 'call'),
            call_display: this.argList(meta, 'call_display'),
            signature: this.argList(meta, 'signature')
          })
        }
      }
    }
  }

  private extendForeignkeys(fkData: ForeignKey[]): void {
    const meta = this.dbmetadata.tables
    for (const fk of fkData) {
      const [parentschema, childschema] = this.escapedNames([fk.parentschema, fk.childschema])
      const [parenttable, childtable] = this.escapedNames([fk.parenttable, fk.childtable])
      const [childcol, parcol] = this.escapedNames([fk.childcolumn, fk.parentcolumn])
      const childcolmeta = meta.get(childschema!)?.get(childtable!)?.get(childcol!)
      const parcolmeta = meta.get(parentschema!)?.get(parenttable!)?.get(parcol!)
      if (childcolmeta === undefined || parcolmeta === undefined) continue
      const key: ForeignKey = {
        parentschema: parentschema!,
        parenttable: parenttable!,
        parentcolumn: parcol!,
        childschema: childschema!,
        childtable: childtable!,
        childcolumn: childcol!
      }
      childcolmeta.foreignkeys.push(key)
      parcolmeta.foreignkeys.push(key)
    }
  }

  private extendDatatypes(typeData: [string, string][]): void {
    const meta = this.dbmetadata.datatypes
    for (const [schema, typeName] of typeData.map((t) => this.escapedNames(t))) {
      if (!meta.has(schema!)) meta.set(schema!, new Map())
      meta.get(schema!)!.set(typeName!, null)
    }
  }

  /** pgcompleter.py: PGCompleter.extend_query_history——按执行过的语句调整排序。 */
  extendQueryHistory(text: string): void {
    this.prioritizer.update(text, this.dialect.kind)
  }

  private setSearchPath(searchPath: string[]): void {
    this.searchPath = this.escapedNames(searchPath)
  }

  private extendCasing(words: readonly string[]): void {
    this.casing = new Map(words.map((w) => [w.toLowerCase(), w]))
  }

  /** pgcompleter.py: PGCompleter.case */
  private case(word: string): string {
    return this.casing.get(word) ?? word
  }

  // —— 匹配 ——

  /**
   * pgcompleter.py: PGCompleter.find_matches——按输入的最后一个词匹配候选。mode 为 'fuzzy'（模糊匹配，同分按名字
   * 的使用频度）或 'strict'（只认开头，同分按关键字的使用频度）。wholeText 时按整段 text 匹配，不取最后一个词、
   * 不去开头的引号（mycli 的枚举值前缀：find_fuzzy_matches(prefix, prefix.lower(), …)）。
   */
  findMatches(
    text: string,
    collection: readonly (string | Candidate)[],
    mode: 'fuzzy' | 'strict' = 'fuzzy',
    meta: string | null = null,
    wholeText = false
  ): Match[] {
    if (collection.length === 0) return []
    const typePriority = meta === null ? -1 : PRIO_ORDER.indexOf(meta)
    text = (wholeText ? text : lastWord(text, 'most_punctuations')).toLowerCase()
    const textLen = text.length
    // 以引号开头：在手动给名字加引号，按引号之后的部分匹配（替换长度仍含引号）
    if (!wholeText && text && text[0] === this.dialect.quote) text = text.slice(1)

    const fuzzy = mode === 'fuzzy'
    // 关键字的次数按关键字表的写法记（都是大写）；keyword_casing 为 auto 时候选可能已转成小写，按大写查
    const priorityFunc = fuzzy
      ? (item: string) => this.prioritizer.nameCount(item)
      : (item: string) => this.prioritizer.keywordCount(item.toUpperCase())
    let match: (item: string) => [number, number] | null
    if (fuzzy) {
      const pat = new RegExp(`(${[...text].map(escapeRegex).join('.*?')})`, 'u')
      match = (item) => {
        const lower = item.toLowerCase()
        // 第一个词完全相同的排最前（如输入 e 时 'Entries E' 排在 'EndUsers EU' 之前）
        const head = lower.slice(0, text.length + 1)
        if (head === text || head === text + ' ') return [Infinity, -1]
        const r = pat.exec(this.unescapeName(lower))
        return r === null ? null : [-r[0].length, -r.index]
      }
    } else {
      match = (item) => {
        const matchPoint = item.toLowerCase().slice(0, text.length).indexOf(text)
        // 关键字一律排在各模糊匹配之后
        return matchPoint >= 0 ? [-Infinity, -matchPoint] : null
      }
    }

    const matches: Match[] = []
    for (const cand of collection) {
      let item: string
      let prio: number
      let displayMeta: string | null
      let prio2: number
      let display: string
      let sortKey: [number, number] | null
      let datatype: string | null = null
      if (typeof cand === 'string') {
        ;[item, displayMeta, prio, prio2, display] = [cand, meta, 0, 0, cand]
        sortKey = match(cand)
      } else {
        ;({ completion: item, prio, meta: displayMeta, prio2, display, datatype } = cand)
        if (displayMeta === null) displayMeta = meta
        const synMatches = cand.synonyms.map(match).filter((m): m is [number, number] => m !== null)
        sortKey = synMatches.length > 0 ? (maxPriority(synMatches) as [number, number]) : null
      }
      if (sortKey === null) continue
      if (displayMeta && displayMeta.length > 50) displayMeta = displayMeta.slice(0, 47) + '...'
      // 同组同位置时按字典序（"aa" 先于 "ab"，短的先于长的："user" 先于 "users"）；先不分大小写，再分
      const lexicalPriority: PriorityItem[] = [
        ...[...this.unescapeName(item.toLowerCase())].map((c) =>
          c === ' ' || c === '_' ? 0 : -c.codePointAt(0)!
        ),
        1,
        ...item
      ]
      item = this.case(item)
      display = this.case(display)
      const completion: Completion = {
        text: item,
        startPosition: textLen === 0 ? 0 : -textLen,
        displayMeta,
        display
      }
      if (datatype !== null) completion.datatype = datatype
      matches.push({
        completion,
        priority: [sortKey, typePriority, prio, priorityFunc(item), prio2, lexicalPriority]
      })
    }
    return matches
  }

  /**
   * pgcompleter.py: PGCompleter.get_completions——text 为整段文字，cursor 为光标位置。按 suggest_type 的各建议取候选，
   * 按优先度从高到低排好。
   */
  getCompletions(text: string, cursor: number): Completion[] {
    const textBeforeCursor = text.slice(0, cursor)
    const wordBeforeCursor = lastWord(textBeforeCursor, 'all_punctuations')
    const matches: Match[] = []
    const suggestions = suggestType(text, textBeforeCursor, this.dialect)
    for (const suggestion of suggestions) {
      // mycli：枚举值只给枚举值
      if (suggestion.type === 'EnumValue') {
        const enumMatches = this.getEnumValueMatches(
          suggestion,
          wordBeforeCursor,
          text.slice(cursor)
        )
        if (enumMatches !== null) return enumMatches
        continue
      }
      matches.push(...this.matcherFor(suggestion, wordBeforeCursor, textBeforeCursor))
    }
    const sorted = matches
      .sort((a, b) => comparePriority(b.priority, a.priority))
      .map((m) => m.completion)
    if (this.dialect.family !== 'mysql') return sorted
    // mycli：排好后按文字去重，留排在前面的（uniq_completions_str = dict.fromkeys(…)）
    const seen = new Set<string>()
    return sorted.filter((c) => {
      if (seen.has(c.text)) return false
      seen.add(c.text)
      return true
    })
  }

  private matcherFor(suggestion: Suggestion, word: string, textBeforeCursor: string): Match[] {
    switch (suggestion.type) {
      case 'FromClauseItem':
        return this.getFromClauseItemMatches(suggestion, word)
      case 'JoinCondition':
        return this.getJoinConditionMatches(suggestion, word)
      case 'Join':
        return this.getJoinMatches(suggestion, word)
      case 'Column':
        return this.getColumnMatches(suggestion, word)
      case 'Function':
        return this.getFunctionMatches(suggestion, word)
      case 'Schema':
        return this.getSchemaMatches(suggestion, word)
      case 'Table':
        return this.getTableMatches(suggestion, word)
      case 'View':
        return this.getViewMatches(suggestion, word)
      case 'Alias':
        return this.findMatches(word, suggestion.aliases, 'fuzzy', 'table alias')
      case 'Database':
        return this.findMatches(word, this.databases, 'fuzzy', 'database')
      case 'Keyword':
        return this.getKeywordMatches(suggestion, word, textBeforeCursor)
      case 'Datatype':
        return this.getDatatypeMatches(suggestion, word)
      case 'Special':
        // pgcli get_special_matches：没有 pgspecial（命令行的反斜杠命令）时为空
        return []
      // mycli：
      case 'CharacterSet':
        return this.findMatches(word, this.mysqlData.characterSets, 'fuzzy', 'character set')
      case 'Collation':
        return this.findMatches(word, this.mysqlData.collations, 'fuzzy', 'collation')
      case 'Introducer':
        return this.findMatches(
          word,
          this.mysqlData.characterSets.map((x) => `_${x}`),
          'fuzzy',
          'introducer'
        )
      case 'Show':
        // mycli：show 分支同样按 keyword_casing 转换大小写
        return this.findMatches(
          word,
          this.mysqlData.showItems.map(this.keywordCase(word)),
          'fuzzy',
          'show'
        )
      case 'User':
        return this.findMatches(word, this.mysqlData.users, 'fuzzy', 'user')
      case 'Change':
        return this.findMatches(word, this.dialect.changeItems, 'fuzzy', 'change')
      case 'Procedure': {
        // mycli populate_schema_objects：schema or self.dbname（search_path 的项已转义过，不再转义）
        const schema = suggestion.schema ? this.escapeName(suggestion.schema) : this.searchPath[0]
        const procedures = schema === undefined ? [] : (this.procedures.get(schema) ?? [])
        return this.findMatches(word, procedures, 'fuzzy', 'procedure')
      }
      case 'EnumValue':
        return []
    }
  }

  /** pgcompleter.py: PGCompleter.get_column_matches */
  private getColumnMatches(
    suggestion: Extract<Suggestion, { type: 'Column' }>,
    word: string
  ): Match[] {
    const tables = suggestion.tableRefs
    const doQualify =
      suggestion.qualifiable &&
      { always: true, never: false, if_more_than_one_table: tables.length > 1 }[
        this.settings.qualifyColumns
      ]
    const qualify = (col: string, tbl: string): string =>
      doQualify ? `${tbl}.${this.case(col)}` : this.case(col)
    let scopedCols = this.populateScopedCols(tables, suggestion.localTables)
    const makeCand = (col: ColumnMetadata, ref: string): Candidate =>
      candidate(qualify(col.name, ref), {
        meta: 'column',
        synonyms: [col.name, generateAlias(this.case(col.name), this.settings.aliasMap)],
        datatype: col.datatype
      })
    const flatCols = (): Candidate[] =>
      [...scopedCols].flatMap(([t, cols]) => cols.map((c) => makeCand(c, this.ref(t))))

    if (suggestion.requireLastTable) {
      // 'tbl1 JOIN tbl2 USING (…'：只建议最后一张表里、又出现在别的表里的列
      const ltbl = this.ref(tables.at(-1)!)
      const otherTblCols = new Set(
        [...scopedCols]
          .filter(([t]) => this.ref(t) !== ltbl)
          .flatMap(([, cs]) => cs.map((c) => c.name))
      )
      scopedCols = new Map(
        [...scopedCols]
          .filter(([t]) => this.ref(t) === ltbl)
          .map(([t, cols]) => [t, cols.filter((col) => otherTblCols.has(col.name))])
      )
    }
    const lastword = lastWord(word, 'most_punctuations')
    if (lastword === '*') {
      if (suggestion.context === 'insert') {
        const filter = (col: ColumnMetadata): boolean =>
          !col.hasDefault ||
          !this.settings.insertColSkipPatterns.some(
            (p) => col.default !== null && p.test(col.default)
          )
        scopedCols = new Map([...scopedCols].map(([t, cols]) => [t, cols.filter(filter)]))
      }
      if (this.settings.asteriskColumnOrder === 'alphabetic') {
        scopedCols = new Map(
          [...scopedCols].map(([t, cols]) => [
            t,
            [...cols].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          ])
        )
      }
      let collist: string
      if (
        lastword !== word &&
        tables.length === 1 &&
        word[word.length - lastword.length - 1] === '.'
      ) {
        // 输入的是 x.*：除第一列外都补上 "x."（第一列只替换 *）
        const sep = ', ' + word.slice(0, -1)
        collist = flatCols()
          .map((c) => this.case(c.completion))
          .join(sep)
      } else {
        collist = [...scopedCols]
          .flatMap(([t, cs]) => cs.map((c) => qualify(c.name, this.ref(t))))
          .join(', ')
      }
      return [
        {
          completion: { text: collist, startPosition: -1, displayMeta: 'columns', display: '*' },
          priority: [1, 1, 1]
        }
      ]
    }
    return this.findMatches(word, flatCols(), 'fuzzy', 'column')
  }

  /** 表引用的指称名（pgcli TableReference.ref；mycli / litecli 为别名或表名）。 */
  private ref(t: TableReference): string {
    return tableRef(t, this.dialect)
  }

  /** pgcompleter.py: PGCompleter.alias——表的别名，与语句里已有的不重复。 */
  private alias(tbl: string, tbls: TableReference[]): string {
    tbl = this.case(tbl)
    const refs = new Set(tbls.map((t) => this.normalizeRef(this.ref(t))))
    if (this.settings.generateAliases) {
      tbl = generateAlias(this.unescapeName(tbl), this.settings.aliasMap)
    }
    if (!refs.has(this.normalizeRef(tbl))) return tbl
    const q = this.dialect.quote
    for (let i = 2; ; i++) {
      const a = tbl[0] === q ? q + tbl.slice(1, -1) + i + q : tbl + i
      if (!refs.has(this.normalizeRef(a))) return a
    }
  }

  /** pgcompleter.py: PGCompleter.get_join_matches——按外键给出 JOIN 的表与连接条件。 */
  private getJoinMatches(suggestion: Extract<Suggestion, { type: 'Join' }>, word: string): Match[] {
    const tbls = suggestion.tableRefs
    const cols = this.populateScopedCols(tbls)
    const qualified = new Map(tbls.map((t) => [this.normalizeRef(this.ref(t)), t.schema]))
    const refPrio = new Map(tbls.map((t, n) => [this.normalizeRef(this.ref(t)), n]))
    const refs = new Set(tbls.map((t) => this.normalizeRef(this.ref(t))))
    const otherTbls = new Set(
      [...cols.keys()].slice(0, -1).map((t) => `${t.schema}\u0000${t.name}`)
    )
    const joins: Candidate[] = []
    const c = (w: string): string => this.case(w)
    for (const [rtbl, rcols] of cols) {
      for (const rcol of rcols) {
        for (const fk of rcol.foreignkeys) {
          const right = { schema: rtbl.schema, tbl: rtbl.name, col: rcol.name }
          const child = { schema: fk.childschema, tbl: fk.childtable, col: fk.childcolumn }
          const parent = { schema: fk.parentschema, tbl: fk.parenttable, col: fk.parentcolumn }
          const parentIsRight =
            parent.schema === right.schema && parent.tbl === right.tbl && parent.col === right.col
          const left = parentIsRight ? child : parent
          if (suggestion.schema && left.schema !== suggestion.schema) continue
          const rref = this.ref(rtbl)
          let join: string
          if (this.settings.generateAliases || refs.has(this.normalizeRef(left.tbl))) {
            const lref = this.alias(left.tbl, suggestion.tableRefs)
            join = `${c(left.tbl)} ${lref} ON ${lref}.${c(left.col)} = ${rref}.${c(right.col)}`
          } else {
            join = `${c(left.tbl)} ON ${c(left.tbl)}.${c(left.col)} = ${rref}.${c(right.col)}`
          }
          const alias = generateAlias(this.case(left.tbl), this.settings.aliasMap)
          const synonyms = [join, `${alias} ON ${alias}.${c(left.col)} = ${rref}.${c(right.col)}`]
          // 带模式：新表与原表同模式且原表写了模式，或新表在别的模式（public 除外）
          if (
            !suggestion.schema &&
            ((qualified.get(this.normalizeRef(rref)) && left.schema === right.schema) ||
              (left.schema !== right.schema && left.schema !== 'public'))
          ) {
            join = `${left.schema}.${join}`
          }
          const prio =
            (refPrio.get(this.normalizeRef(rref)) ?? 0) * 2 +
            (otherTbls.has(`${left.schema}\u0000${left.tbl}`) ? 0 : 1)
          joins.push(candidate(join, { prio, meta: 'join', synonyms }))
        }
      }
    }
    return this.findMatches(word, joins, 'fuzzy', 'join')
  }

  /** pgcompleter.py: PGCompleter.get_join_condition_matches——ON 之后的连接条件（外键、同名列）。 */
  private getJoinConditionMatches(
    suggestion: Extract<Suggestion, { type: 'JoinCondition' }>,
    word: string
  ): Match[] {
    const tbls = [...this.populateScopedCols(suggestion.tableRefs)]
    const cols = tbls.flatMap(([t, cs]) =>
      cs.map((col): [TableReference, ColumnMetadata] => [t, col])
    )
    const lrefTable = suggestion.parent ?? suggestion.tableRefs.at(-1)
    if (lrefTable === undefined) return []
    const lref = this.ref(lrefTable)
    const found = tbls.filter(([t]) => this.ref(t) === lref).at(-1)
    // 输入的表名前缀不对
    if (found === undefined) return []
    const [ltbl, lcols] = found
    const conds: Candidate[] = []
    const foundConds = new Set<string>()
    // 离光标越近的表优先
    const refPrio = new Map(suggestion.tableRefs.map((tbl, num) => [this.ref(tbl), num]))
    const addCond = (
      lcol: string,
      rcol: string,
      rref: string,
      prio: number,
      meta: string
    ): void => {
      const prefix = suggestion.parent ? '' : this.ref(ltbl) + '.'
      const cond = `${prefix}${this.case(lcol)} = ${rref}.${this.case(rcol)}`
      if (!foundConds.has(cond)) {
        foundConds.add(cond)
        conds.push(candidate(cond, { prio: prio + (refPrio.get(rref) ?? 0), meta }))
      }
    }
    const key = (schema: string | null, tbl: string, col: string): string =>
      `${schema}\u0000${tbl}\u0000${col}`
    // (模式, 表, 列) → 各表
    const coldict = new Map<string, TableReference[]>()
    for (const [t, col] of cols) {
      if (this.ref(t) === lref) continue
      const k = key(t.schema, t.name, col.name)
      coldict.set(k, [...(coldict.get(k) ?? []), t])
    }
    // 左表的外键：另一端的表也在语句里时给出连接条件
    for (const lcol of lcols) {
      for (const fk of lcol.foreignkeys) {
        const child = { schema: fk.childschema, tbl: fk.childtable, col: fk.childcolumn }
        const par = { schema: fk.parentschema, tbl: fk.parenttable, col: fk.parentcolumn }
        const leftIsChild =
          ltbl.schema === child.schema && ltbl.name === child.tbl && lcol.name === child.col
        const [left, right] = leftIsChild ? [child, par] : [par, child]
        for (const rtbl of coldict.get(key(right.schema, right.tbl, right.col)) ?? []) {
          addCond(left.col, right.col, this.ref(rtbl), 2000, 'fk join')
        }
      }
    }
    // 同名同类型的列
    const colTable = new Map<string, TableReference[]>()
    for (const [t, col] of cols) {
      const k = `${col.name}\u0000${col.datatype}`
      colTable.set(k, [...(colTable.get(k) ?? []), t])
    }
    for (const col of lcols) {
      for (const rtbl of colTable.get(`${col.name}\u0000${col.datatype}`) ?? []) {
        if (this.ref(rtbl) === this.ref(ltbl)) continue
        const prio = ['integer', 'bigint', 'smallint'].includes(col.datatype ?? '') ? 1000 : 0
        addCond(col.name, col.name, this.ref(rtbl), prio, 'name join')
      }
    }
    return this.findMatches(word, conds, 'fuzzy', 'join')
  }

  /**
   * pgcompleter.py: PGCompleter.get_function_matches。「public」模式的函数不写模式也补；mycli / litecli 取不写前缀时
   * 查找的库（dbname）的函数（mycli populate_schema_objects(schema or dbname)），这里为 searchPath 里的。
   */
  private getFunctionMatches(
    suggestion: Extract<Suggestion, { type: 'Function' }>,
    word: string,
    alias = false
  ): Match[] {
    const isPublic = (f: FunctionMetadata): boolean =>
      f.isPublic ||
      (this.dialect.family !== 'postgresql' &&
        this.searchPath.includes(this.escapeName(f.schemaName)))
    let filt: (f: FunctionMetadata) => boolean
    if (suggestion.usage === 'from') {
      // FROM 里只建议能作表用的函数。pgcli 在这里拿函数所在模式的原名去比已转义的 search_path，search_path 里要加引号的
      // 模式（如 "Sales"）的函数因此补不出；这里同样转义后再比
      filt = (f) =>
        !f.isAggregate &&
        !f.isWindow &&
        !f.isExtension &&
        (isPublic(f) ||
          this.searchPath.includes(this.escapeName(f.schemaName)) ||
          f.schemaName === suggestion.schema)
    } else {
      alias = false
      filt = (f) => !f.isExtension && (isPublic(f) || f.schemaName === suggestion.schema)
    }
    const argMode =
      suggestion.usage === 'signature'
        ? 'signature'
        : suggestion.usage === 'special'
          ? null
          : 'call'
    // 同名重载的函数只留一个候选
    const funcs = new Map<string, Candidate>()
    for (const f of this.populateFunctions(suggestion.schema, filt)) {
      const cand = this.makeCand(f, alias, suggestion, argMode)
      funcs.set(JSON.stringify(cand), cand)
    }
    const matches = this.findMatches(word, [...funcs.values()], 'fuzzy', 'function')
    if (!suggestion.schema && !suggestion.usage) {
      // 另按开头匹配内置函数。mycli / litecli 对内置函数也按 keyword_casing 转换大小写（get_completions 的
      // function 分支 casing=self.keyword_casing）；pgcli 原样给出
      const builtins =
        this.dialect.family === 'postgresql'
          ? this.dialect.functions
          : this.dialect.functions.map(this.keywordCase(word))
      matches.push(...this.findMatches(word, builtins, 'strict', 'function'))
    }
    return matches
  }

  /** pgcompleter.py: PGCompleter.get_schema_matches */
  private getSchemaMatches(
    suggestion: Extract<Suggestion, { type: 'Schema' }>,
    word: string
  ): Match[] {
    let schemaNames = [...this.dbmetadata.tables.keys()]
    // 除非明确要，不列 pg_ 开头的模式（多是临时模式）
    if (!word.startsWith('pg_')) schemaNames = schemaNames.filter((s) => !s.startsWith('pg_'))
    if (suggestion.quoted) schemaNames = schemaNames.map((s) => this.escapeSchema(s))
    return this.findMatches(word, schemaNames, 'fuzzy', 'schema')
  }

  /** pgcompleter.py: PGCompleter.get_from_clause_item_matches */
  private getFromClauseItemMatches(
    s: Extract<Suggestion, { type: 'FromClauseItem' }>,
    word: string
  ): Match[] {
    const alias = this.settings.generateAliases
    return [
      ...this.getTableMatches(
        { type: 'Table', schema: s.schema, tableRefs: s.tableRefs, localTables: s.localTables },
        word,
        alias
      ),
      ...this.getViewMatches(
        { type: 'View', schema: s.schema, tableRefs: s.tableRefs },
        word,
        alias
      ),
      ...this.getFunctionMatches(
        { type: 'Function', schema: s.schema, tableRefs: s.tableRefs, usage: 'from' },
        word,
        alias
      )
    ]
  }

  /** pgcompleter.py: PGCompleter._arg_list——函数的参数表文字，如 `(_foo:=23)`。 */
  private argList(func: FunctionMetadata, usage: 'call' | 'call_display' | 'signature'): string {
    const args = func.args()
    if (usage === 'call' && args.length < 2) return '()'
    if (usage === 'call' && func.hasVariadic()) return '()'
    const multiline = usage === 'call' && args.length > CALL_ARG_ONELINER_MAX
    const maxArgLen = multiline ? Math.max(...args.map((a) => a.name.length)) : 0
    const formatted = args.map((arg) => this.formatArg(usage, arg, maxArgLen))
    if (multiline) return '(' + formatted.map((a) => '\n    ' + a).join(',') + '\n)'
    return '(' + formatted.join(', ') + ')'
  }

  /**
   * pgcompleter.py: PGCompleter._format_arg，样式为 pgcli 的默认值：signature「{arg_name} {arg_type}」，
   * call「{arg_name: <{max_arg_len}} := {arg_default}」，call_display「{arg_name}」。
   */
  private formatArg(
    usage: 'call' | 'call_display' | 'signature',
    arg: ColumnMetadata,
    maxArgLen: number
  ): string {
    let argDefault = ''
    if (arg.hasDefault) {
      // 去掉结尾的 ::(模式.)类型
      argDefault = (arg.default ?? 'NULL').replace(/::[\w.]+(\[\])?$/, '')
    }
    const name = this.case(arg.name)
    switch (usage) {
      case 'signature':
        return `${name} ${arg.datatype}`
      case 'call':
        return `${name.padEnd(maxArgLen)} := ${argDefault}`
      case 'call_display':
        return name
    }
  }

  /** pgcompleter.py: PGCompleter._make_cand——表、视图、函数的候选（函数带参数表）。 */
  private makeCand(
    tbl: SchemaObject,
    doAlias: boolean,
    suggestion: { tableRefs: TableReference[] },
    argMode: 'call' | 'signature' | null = null
  ): Candidate {
    const casedTbl = this.case(tbl.name)
    const alias = doAlias ? this.alias(casedTbl, suggestion.tableRefs) : ''
    const synonyms = [casedTbl, generateAlias(casedTbl, this.settings.aliasMap)]
    const maybeAlias = doAlias ? ' ' + alias : ''
    const maybeSchema = tbl.schema ? this.case(tbl.schema) + '.' : ''
    const cache = tbl.meta !== null ? this.argListCache.get(tbl.meta) : undefined
    // MySQL / MariaDB 照 mycli 只插入函数名：参数表是 pgcli 的具名参数写法（a := ），MySQL 没有具名参数，:= 是赋值。
    // 显示时仍带参数表
    const suffix = argMode && cache && this.dialect.family !== 'mysql' ? cache[argMode] : ''
    const displaySuffix =
      argMode === 'call'
        ? (cache?.call_display ?? '')
        : argMode === 'signature'
          ? (cache?.signature ?? '')
          : ''
    const item = maybeSchema + casedTbl + suffix + maybeAlias
    const display = maybeSchema + casedTbl + displaySuffix + maybeAlias
    return candidate(item, { synonyms, prio2: tbl.schema ? 0 : 1, display })
  }

  /** pgcompleter.py: PGCompleter.get_table_matches */
  private getTableMatches(
    suggestion: Extract<Suggestion, { type: 'Table' }>,
    word: string,
    alias = false
  ): Match[] {
    let tables = this.populateSchemaObjects(suggestion.schema, 'tables')
    tables.push(...suggestion.localTables.map((t) => ({ name: t.name, schema: null, meta: null })))
    // 除非明确要，不建议隐含在 search_path 里的 pg_catalog 表
    if (!suggestion.schema && !word.startsWith('pg_')) {
      tables = tables.filter((t) => !t.name.startsWith('pg_'))
    }
    return this.findMatches(
      word,
      tables.map((t) => this.makeCand(t, alias, suggestion)),
      'fuzzy',
      'table'
    )
  }

  /** pgcompleter.py: PGCompleter.get_view_matches */
  private getViewMatches(
    suggestion: Extract<Suggestion, { type: 'View' }>,
    word: string,
    alias = false
  ): Match[] {
    let views = this.populateSchemaObjects(suggestion.schema, 'views')
    if (!suggestion.schema && !word.startsWith('pg_')) {
      views = views.filter((v) => !v.name.startsWith('pg_'))
    }
    return this.findMatches(
      word,
      views.map((v) => this.makeCand(v, alias, suggestion)),
      'fuzzy',
      'view'
    )
  }

  /**
   * pgcompleter.py: PGCompleter.get_keyword_matches——前一个关键字有常见的后续关键字时只给这些；另按 Tabularis 的
   * KEYWORD_ALLOWED_CLAUSES 去掉当前子句里用不上的（见 keyword-clauses.ts）。
   */
  private getKeywordMatches(
    suggestion: Extract<Suggestion, { type: 'Keyword' }>,
    word: string,
    textBeforeCursor: string
  ): Match[] {
    const nextKeywords = suggestion.lastToken
      ? (this.dialect.keywordsTree[suggestion.lastToken] ?? [])
      : []
    let keywords = nextKeywords.length > 0 ? nextKeywords : this.dialect.keywords
    const clause = sqlClauseAt(textBeforeCursor, this.dialect)
    keywords = keywords.filter((k) => keywordAllowed(clause, k))
    return this.findMatches(word, keywords.map(this.keywordCase(word)), 'strict', 'keyword')
  }

  /**
   * 按 keyword_casing 转换大小写。auto 时：pgcli（get_keyword_matches）与 litecli（SQLCompleter.find_matches）看
   * 末字母，是小写就用小写；mycli（SQLCompleter.resolve_casing）取 last_word(…, 'most_punctuations')，首字母或
   * 末字母有一个是小写就用小写。
   */
  private keywordCase(word: string): (s: string) => string {
    let casing = this.settings.keywordCasing
    if (casing === 'auto') {
      const mysql = this.dialect.family === 'mysql'
      const last = mysql ? lastWord(word, 'most_punctuations') : word
      const lowerAt = (c: string | undefined): boolean => c !== undefined && isLower(c)
      casing = lowerAt(last.at(-1)) || (mysql && lowerAt(last[0])) ? 'lower' : 'upper'
    }
    return casing === 'upper' ? (s) => s.toUpperCase() : (s) => s.toLowerCase()
  }

  /** pgcompleter.py: PGCompleter.get_datatype_matches */
  private getDatatypeMatches(
    suggestion: Extract<Suggestion, { type: 'Datatype' }>,
    word: string
  ): Match[] {
    const types = this.populateSchemaObjects(suggestion.schema, 'datatypes').map((t) =>
      this.makeCand(t, false, { tableRefs: [] })
    )
    const matches = this.findMatches(word, types, 'fuzzy', 'datatype')
    if (!suggestion.schema) {
      // 另按开头匹配内置类型
      matches.push(...this.findMatches(word, this.dialect.datatypes, 'strict', 'datatype'))
    }
    return matches
  }

  /**
   * mycli：enum_value——「列 = 」之后只给这一列的枚举值（加单引号）；在引号里时按已输入的前缀匹配，替换到开头的
   * 引号，后面没有收尾引号时补上。光标后紧跟别的内容时不给。没有取值时为 null（照常给其他建议）。
   */
  private getEnumValueMatches(
    suggestion: Extract<Suggestion, { type: 'EnumValue' }>,
    word: string,
    textAfterCursor: string
  ): Completion[] | null {
    const values = this.populateEnumValues(
      suggestion.tableRefs,
      suggestion.column,
      suggestion.parent
    )
    if (suggestion.valuePrefix !== undefined && suggestion.quote !== undefined) {
      const quote = suggestion.quote
      if (!textAfterCursor.startsWith(quote) && textAfterCursor.includes(quote)) return []
      if (
        textAfterCursor &&
        !(
          textAfterCursor.startsWith(quote) ||
          /^\s/.test(textAfterCursor) ||
          ';,)'.includes(textAfterCursor[0]!)
        )
      ) {
        return []
      }
      const closing = textAfterCursor.startsWith(quote) ? '' : quote
      const replacementLength = suggestion.replacementLength ?? 0
      // 按整个前缀匹配（前缀里可有空格、句点等）
      return this.findMatches(suggestion.valuePrefix, values, 'fuzzy', 'enum value', true)
        .sort((a, b) => comparePriority(b.priority, a.priority))
        .map(({ completion }) => ({
          ...completion,
          text:
            quote +
            completion.text.replaceAll('\\', '\\\\').replaceAll(quote, quote + quote) +
            closing,
          startPosition: -replacementLength
        }))
    }
    if (values.length === 0) return null
    const quoted = values.map((v) => `'${v.replaceAll("'", "''")}'`)
    return this.findMatches(word, quoted, 'fuzzy', 'enum value')
      .sort((a, b) => comparePriority(b.priority, a.priority))
      .map((m) => m.completion)
  }

  /** mycli：populate_enum_values——语句里的表（可按前缀限定）中这一列的枚举值。 */
  private populateEnumValues(
    tables: TableReference[],
    column: string,
    parent: string | null
  ): string[] {
    const strip = (name: string): string =>
      name.length >= 2 && name[0] === '`' && name[name.length - 1] === '`'
        ? name.slice(1, -1)
        : name
    const columnKey = this.escapeName(strip(column))
    const parentKey = parent ? strip(parent) : null
    const values: string[] = []
    for (const t of tables) {
      if (
        parentKey &&
        !(
          parentKey === t.alias ||
          parentKey === t.name ||
          (t.schema && parentKey === `${t.schema}.${t.name}`)
        )
      ) {
        continue
      }
      // mycli：schema or self.dbname（search_path 的项已转义过，不再转义）
      const schema = t.schema ? this.escapeName(t.schema) : this.searchPath[0]
      if (schema === undefined) continue
      const col = this.dbmetadata.tables.get(schema)?.get(this.escapeName(t.name))?.get(columnKey)
      if (col) values.push(...parseEnumValues(col.datatype))
    }
    return [...new Set(values)]
  }

  /**
   * pgcompleter.py: PGCompleter.populate_scoped_cols——一组表的列。语句自带的表（CTE、带别名的子查询）优先于库里
   * 的同名表；子查询 SELECT * / t.* 的列（sqls）按表结构展开。
   */
  private populateScopedCols(
    scopedTbls: TableReference[],
    localTbls: TableMetadata[] = []
  ): Map<TableReference, ColumnMetadata[]> {
    const ctes = new Map(localTbls.map((t) => [this.normalizeRef(t.name), t]))
    const columns = new Map<string, [TableReference, ColumnMetadata[]]>()
    const addcols = (
      schema: string | null,
      rel: string,
      alias: string | null,
      reltype: string,
      cols: ColumnMetadata[]
    ): void => {
      const tbl = tableReference(schema, rel, alias, reltype === 'functions')
      const key = JSON.stringify(tbl)
      if (!columns.has(key)) columns.set(key, [tbl, []])
      columns.get(key)![1].push(...cols)
    }
    const lookup = (
      tbl: TableReference,
      add: (schema: string, rel: string, reltype: string, cols: ColumnMetadata[]) => void
    ): void => {
      // pgcli 在这里对 search_path 的项又 escape_name 一次（set_search_path 已转义过），需要引号的模式名因此取不到
      // 列；这里只转义语句里写的模式名。mycli 同样只按原名找一次（「DO NOT escape schema names」）
      const schemas = tbl.schema ? [this.escapeName(tbl.schema)] : this.searchPath
      for (const schema of schemas) {
        const relname = this.escapeName(tbl.name)
        if (tbl.isFunction) {
          // 返回结果集的函数的列
          for (const func of this.dbmetadata.functions.get(schema)?.get(relname) ?? []) {
            add(schema, relname, 'functions', func.fields())
          }
        } else {
          for (const reltype of ['tables', 'views'] as const) {
            const cols = this.dbmetadata[reltype].get(schema)?.get(relname)
            if (cols && cols.size > 0) {
              add(schema, relname, reltype, [...cols.values()])
              break
            }
          }
        }
      }
    }
    for (const tbl of scopedTbls) {
      const local = tbl.schema === null ? ctes.get(this.normalizeRef(tbl.name)) : undefined
      if (local !== undefined) {
        // pgcli 这里的实参次序有误（把 "CTE" 当作了别名），按形参次序改正
        const cols = [...local.columns]
        for (const star of local.starTables ?? []) {
          lookup(star, (_schema, _rel, _reltype, starCols) => cols.push(...starCols))
        }
        addcols(null, tbl.name, tbl.alias, 'CTE', cols)
        continue
      }
      lookup(tbl, (schema, rel, reltype, cols) => addcols(schema, rel, tbl.alias, reltype, cols))
    }
    return new Map([...columns.values()])
  }

  /** pgcompleter.py: PGCompleter._get_schemas——从哪些模式里取对象（输入了模式前缀时只取它）。 */
  private getSchemas(objTyp: Kind, schema: string | null): string[] {
    const metadata = this.dbmetadata[objTyp]
    if (schema) {
      const escaped = this.escapeName(schema)
      return metadata.has(escaped) ? [escaped] : []
    }
    return this.settings.searchPathFilter ? this.searchPath : [...metadata.keys()]
  }

  /** pgcompleter.py: PGCompleter._maybe_schema */
  private maybeSchema(schema: string, parent: string | null): string | null {
    return parent || this.searchPath.includes(schema) ? null : schema
  }

  /** pgcompleter.py: PGCompleter.populate_schema_objects——表、视图或类型。 */
  private populateSchemaObjects(
    schema: string | null,
    objType: Exclude<Kind, 'functions'>
  ): SchemaObject[] {
    return this.getSchemas(objType, schema).flatMap((sch) =>
      [...(this.dbmetadata[objType].get(sch)?.keys() ?? [])].map((obj) => ({
        name: obj,
        schema: this.maybeSchema(sch, schema),
        meta: null
      }))
    )
  }

  /** pgcompleter.py: PGCompleter.populate_functions——同名重载的各函数分别给出。 */
  private populateFunctions(
    schema: string | null,
    filterFunc: (f: FunctionMetadata) => boolean
  ): SchemaObject[] {
    return this.getSchemas('functions', schema).flatMap((sch) =>
      [...(this.dbmetadata.functions.get(sch) ?? new Map<string, FunctionMetadata[]>())].flatMap(
        ([func, metas]) =>
          metas
            .filter(filterFunc)
            .map((meta) => ({ name: func, schema: this.maybeSchema(sch, schema), meta }))
      )
    )
  }
}
