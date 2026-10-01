// CodeMirror 的补全源：只取光标所在的那条语句（按 lang-sql 语法树的 Statement 节点），交给补全引擎，按引擎排好的
// 次序原样列出（filter: false）。
// 语法树还没解析完时（刚载入很长的文字）先再解析一会儿，仍没解析完就这次不补全：用解析了一半的树切不出光标所在的语句，
// 会把一大段文字交给引擎、卡住界面。
// 排序与筛选全照 pgcli 的 find_matches，所以不用 CodeMirror 自己的筛选：不给 validFor（CodeMirror 规定 filter 为
// false 时不能给）、boost（只在它自己筛选时起作用），也不分 section（会按分组重排）；每次输入重新算一遍。
// 编辑器里用 sqlLanguage：lang-sql 的语言（高亮、切分语句）配上这个补全源，不用 lang-sql 自带的补全源。
import {
  insertCompletionText,
  type Completion as CmCompletion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete'
import { ensureSyntaxTree, LanguageSupport } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { codemirrorDialect } from '../data-source-sql'
import type { SqlKind } from '@shared/data-source'
import type { CompletionSchema } from '@shared/data-source-query'
import { SqlCompleter, type Completion } from './completer'
import { escapeRegex, lastWord } from './parseutils/utils'
import type { PrevalenceCounter } from './prioritization'

export interface SqlCompletionSourceOptions {
  kind: SqlKind
  /** 表结构；取不到时为 null（只补关键字、内置函数与类型）。表结构变了要重建补全源（重建语言）。 */
  metadata: CompletionSchema | null
  /**
   * 编辑器里只写语句的一段时（表数据的 WHERE / ORDER BY 框），这段之前的文字，如
   * `SELECT * FROM "public"."users" WHERE `：补全按「前缀 + 编辑器里的全部文字」判断。不给时按光标所在的语句。
   */
  prefix?: string
  /**
   * 使用次数的计数器（用得多的名字与关键字排前，见 prioritization.ts）：同一数据源的各个编辑器共用一个，表结构换了也沿用。
   * 不给即不按使用次数排。
   */
  prioritizer?: PrevalenceCounter
}

/** 语法树（取自 CodeMirror 的接口，不直接依赖 lezer；同 sql-statements） */
type Tree = NonNullable<ReturnType<typeof ensureSyntaxTree>>

/** 语法树还没解析完时，每次补全最多再解析多久（毫秒；同 CodeMirror 的默认值），解析的进度留着下次接着用 */
const PARSE_BUDGET_MS = 50

const EMPTY_METADATA: CompletionSchema = {
  databases: [],
  schemas: [],
  searchPath: [],
  foreignKeys: []
}

/** pgcli 的 display_meta 对应的 CodeMirror 选项类型（图标）；表与模式同 lang-sql 自带补全的写法。 */
const OPTION_TYPES: Readonly<Record<string, string>> = {
  keyword: 'keyword',
  function: 'function',
  procedure: 'function',
  table: 'type',
  view: 'type',
  datatype: 'type',
  schema: 'namespace',
  database: 'namespace',
  column: 'property',
  columns: 'property',
  'table alias': 'constant',
  join: 'text',
  'name join': 'text',
  'fk join': 'text',
  'enum value': 'enum'
}

/** 光标所在语句的范围：光标在某条语句里（含紧挨着的末尾，分号之后除外）时为这条，否则为两条语句之间的空白。 */
function statementRange(tree: Tree, state: EditorState, pos: number): { from: number; to: number } {
  let from = 0
  let to = state.doc.length
  const cursor = tree.topNode.cursor()
  if (cursor.firstChild()) {
    do {
      if (cursor.name !== 'Statement') continue
      const endsWithSemicolon = state.sliceDoc(cursor.to - 1, cursor.to) === ';'
      if (endsWithSemicolon && cursor.to <= pos) {
        from = cursor.to
        continue
      }
      if (cursor.from > pos) {
        to = cursor.from
        break
      }
      // 语句的节点不含末尾的空白，光标在其后时语句延到光标处
      from = cursor.from
      to = Math.max(cursor.to, pos)
      break
    } while (cursor.nextSibling())
  }
  return { from, to }
}

/**
 * 光标是否在注释或字符串里。以下两种字符串交给引擎判断：MySQL / MariaDB 的字符串（可补枚举值，mycli）；PostgreSQL
 * 的 $$ 字符串（函数体，pgcli sqlcompletion.py 的 _statement_from_function）。
 */
function insideCommentOrString(
  tree: Tree,
  state: EditorState,
  pos: number,
  kind: SqlKind
): boolean {
  const node = tree.resolveInner(pos, -1)
  if (pos <= node.from) return false
  const tail = state.sliceDoc(Math.max(node.from + 1, node.to - 2), node.to)
  switch (node.name) {
    case 'LineComment':
      return true
    case 'BlockComment':
      return pos < node.to || !tail.endsWith('*/')
    case 'String':
      if (kind === 'mysql' || kind === 'mariadb') return false
      if (kind === 'postgresql' && state.sliceDoc(node.from, node.from + 1) === '$') return false
      return pos < node.to || !/['"$]$/.test(tail)
    default:
      return false
  }
}

/** 在显示的文字里标出与输入相匹配的字符（同 pgcli 模糊匹配的规则：依次出现、尽量靠前）。 */
function matchRanges(typed: string, label: string): number[] {
  if (!typed) return []
  const pattern = new RegExp([...typed].map((c) => `(${escapeRegex(c)})`).join('.*?'), 'diu')
  const indices = pattern.exec(label)?.indices
  if (!indices) return []
  const ranges: number[] = []
  for (const [start, end] of indices
    .slice(1)
    .filter((r): r is [number, number] => r !== undefined)) {
    if (ranges.length > 0 && ranges[ranges.length - 1] === start) ranges[ranges.length - 1] = end
    else ranges.push(start, end)
  }
  return ranges
}

/** 各补全的替换起点多数相同，取最多的那个为结果的 from，其余的在 apply 里按自己的起点替换。 */
function commonStart(completions: Completion[]): number {
  const counts = new Map<number, number>()
  for (const c of completions) counts.set(c.startPosition, (counts.get(c.startPosition) ?? 0) + 1)
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
}

/**
 * SQL 的补全源：kind 为数据源的方言；metadata 给出表结构。按 pgcli 的做法，有输入的词、句点之后或手动唤起时才补全。
 */
export function sqlCompletionSource(options: SqlCompletionSourceOptions): CompletionSource {
  // 第一次补全时才建（编辑器建好后不一定会补全）
  let completer: SqlCompleter | undefined

  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context
    const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS)
    if (tree === null || insideCommentOrString(tree, state, pos, options.kind)) return null
    let text: string
    let cursor: number
    if (options.prefix !== undefined) {
      text = options.prefix + state.doc.toString()
      cursor = options.prefix.length + pos
    } else {
      const range = statementRange(tree, state, pos)
      text = state.sliceDoc(range.from, range.to)
      cursor = pos - range.from
    }
    const before = text.slice(0, cursor)
    const typed = lastWord(before, 'most_punctuations')
    if (!context.explicit && typed === '' && !before.endsWith('.')) return null

    completer ??= new SqlCompleter(
      options.kind,
      options.metadata ?? EMPTY_METADATA,
      {},
      options.prioritizer
    )
    const completions = completer.getCompletions(text, cursor)
    if (completions.length === 0) return null

    const start = commonStart(completions)
    const typedText = typed.replace(/^["`]/, '').toLowerCase()
    const cmOptions = completions.map((c): CmCompletion => {
      const option: CmCompletion = {
        label: c.text,
        type: OPTION_TYPES[c.displayMeta ?? ''] ?? 'variable'
      }
      if (c.display !== c.text) option.displayLabel = c.display
      // 列在右侧显示类型
      if (c.datatype) option.detail = c.datatype
      if (c.startPosition !== start) {
        // from 为（按之后的改动映射过的）结果起点，这一项的起点与它相差固定的长度
        option.apply = (view, _completion, from, to) =>
          view.dispatch(
            insertCompletionText(view.state, c.text, from + (c.startPosition - start), to)
          )
      }
      return option
    })
    return {
      from: pos + start,
      options: cmOptions,
      filter: false,
      getMatch: (completion) => matchRanges(typedText, completion.displayLabel ?? completion.label)
    }
  }
}

/**
 * 数据源方言的 SQL 语言：lang-sql 的语言（高亮、切分语句）配上补全引擎的补全源（不用 lang-sql 自带的补全源）。
 * 不给 completion 即只高亮、不补全。
 */
export function sqlLanguage(
  kind: SqlKind,
  completion?: Omit<SqlCompletionSourceOptions, 'kind'>
): LanguageSupport {
  const { language } = codemirrorDialect(kind)
  return new LanguageSupport(
    language,
    completion === undefined
      ? []
      : [language.data.of({ autocomplete: sqlCompletionSource({ kind, ...completion }) })]
  )
}
