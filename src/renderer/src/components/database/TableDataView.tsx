// 「当前对象」为表或视图时：分页看数据（docs/prd/database.md「当前对象」「分页」）。顶栏左右两个框写 WHERE 与 ORDER BY
// （不带关键字、原样拼进查询，回车生效）：单行 SQL 编辑器，按方言高亮，补全同控制台交给补全引擎、上下文固定为这张表与对应
// 的子句；框前的关键字与输入同为 13px 等宽、隔一个字符宽，框空着时灰、有字时为 SQL 关键字色（同控制台编辑器，随主题；同
// WebStorm）。点表头即把生成的排序写进 ORDER BY 框并生效，这段文字是排序唯一的状态，表头箭头也由它推出。每翻一页现查
// 一页（主键排在 ORDER BY 最后，保证翻页稳定）；总行数另开连接在后台数（只受 WHERE 影响），数的时候照样能翻页。换对象时
// 整个视图重建（调用方按对象给 key）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LanguageSupport } from '@codemirror/language'
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import { RefreshButton } from '@renderer/components/ui/toolbar'
import { filesKeywordColor } from '@renderer/lib/cm6-setup'
import { sqlLanguage, type PrevalenceCounter } from '@renderer/lib/sql-completion'
import { useApp } from '@renderer/store'
import type { SqlKind } from '@shared/data-source'
import {
  dialectOf,
  headerSortOf,
  nextHeaderOrderBy,
  qualifiedName,
  queryFailureText,
  type CompletionSchema,
  type TableCountResult,
  type TablePageResult,
  type TableRef
} from '@shared/data-source-query'
import { BarCodeInput } from './BarCodeInput'
import { DataGrid } from './DataGrid'
import { ExportMenu } from './ExportMenu'
import { Paginator } from './Paginator'

export function TableDataView({
  tabKey,
  kind,
  table,
  completion,
  prioritizer
}: {
  tabKey: string
  kind: SqlKind
  table: TableRef
  /**
   * 两个框补全用的表结构（见 useTableCompletion：通常就是控制台那份，PostgreSQL 的表不在控制台所在的库上时为那个库的）；
   * 还没有为 null
   */
  completion: CompletionSchema | null
  /** 补全的使用次数（见 useCompletionUsage）；Files 面板里直接打开的 SQLite 文件没有 */
  prioritizer: PrevalenceCounter | undefined
}): React.JSX.Element {
  const pageSize = useApp((s) => s.dataPageSize)
  const setDataPageSize = useApp((s) => s.setDataPageSize)
  const theme = useApp((s) => s.theme)
  const dialect = dialectOf(kind)
  const [whereDraft, setWhereDraft] = useState('')
  const [where, setWhere] = useState('')
  const [orderByDraft, setOrderByDraft] = useState('')
  const [orderBy, setOrderBy] = useState('')
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  /** 表格的滚动容器：两个框按 Esc 后焦点交给它（还在加载、出错时不在） */
  const gridRef = useRef<HTMLDivElement>(null)
  // 结果连同它回答的请求一起存：请求变了而结果还是旧的即「读取中」（旧结果照常显示，免得翻页时闪白）
  const [pageResult, setPageResult] = useState<{ key: string; outcome: TablePageResult } | null>(
    null
  )
  const [countResult, setCountResult] = useState<{
    key: string
    outcome: Exclude<TableCountResult, { canceled: true }>
  } | null>(null)
  // table 由调用方按对象重建，这里只当作不变量用
  const [ref] = useState(table)
  const pageKey = JSON.stringify([where, orderBy, page, pageSize, reload])
  const countKey = JSON.stringify([where, reload])

  // 两个框的语言：补全按「SELECT * FROM 这张表 WHERE / ORDER BY 框里的文字」判断
  const languages = useMemo(() => {
    const select = `SELECT * FROM ${qualifiedName(dialectOf(kind), ref)}`
    const clause = (keyword: string): LanguageSupport =>
      sqlLanguage(kind, { metadata: completion, prefix: `${select} ${keyword} `, prioritizer })
    return { where: clause('WHERE'), orderBy: clause('ORDER BY') }
  }, [kind, ref, completion, prioritizer])

  useEffect(() => {
    let current = true
    void window.api
      .readDataSourceTablePage(tabKey, { table: ref, where, orderBy, page, pageSize })
      .then((outcome) => {
        if (current) setPageResult({ key: pageKey, outcome })
      })
    return () => {
      current = false
    }
  }, [tabKey, ref, where, orderBy, page, pageSize, pageKey])

  useEffect(() => {
    let current = true
    void window.api.countDataSourceTableRows(tabKey, ref, where).then((outcome) => {
      if (current && !('canceled' in outcome)) setCountResult({ key: countKey, outcome })
    })
    return () => {
      current = false
      void window.api.cancelDataSourceTableCount(tabKey)
    }
  }, [tabKey, ref, where, countKey])

  /** 应用筛选（连同草稿）：从第一页看起 */
  const applyWhere = (next: string): void => {
    setWhereDraft(next)
    setWhere(next)
    setPage(0)
  }

  /** 应用排序（连同草稿，点表头时即写进框里）：从第一页看起 */
  const applyOrderBy = (next: string): void => {
    setOrderByDraft(next)
    setOrderBy(next)
    setPage(0)
  }

  const loading = pageResult?.key !== pageKey
  const outcome = pageResult?.outcome
  const failure = outcome === undefined || 'result' in outcome ? null : queryFailureText(outcome)
  // 读失败的不留着：下一页读到前显示加载中
  const result = outcome !== undefined && 'result' in outcome ? outcome.result : null
  // 表头箭头：生效的 ORDER BY 恰好是点某列表头的结果才显示那列的
  const sort =
    result === null
      ? null
      : headerSortOf(
          dialect,
          orderBy,
          result.columns.map((column) => column.name)
        )
  const counted = countResult?.key === countKey ? countResult.outcome : null
  const total = counted !== null && 'count' in counted ? counted.count : null
  const totalHint =
    counted === null
      ? '正在计算总行数…'
      : 'count' in counted
        ? undefined
        : `总行数：${queryFailureText(counted)}`

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] bg-panel px-1.5">
        <BarCodeInput
          value={whereDraft}
          onChange={setWhereDraft}
          onSubmit={(text) => applyWhere(text.trim())}
          onClear={() => applyWhere('')}
          escapeFocusRef={gridRef}
          submitTitle="应用筛选"
          label="WHERE"
          labelColor={whereDraft === '' ? undefined : filesKeywordColor[theme]}
          extensions={languages.where}
        />
        <BarCodeInput
          value={orderByDraft}
          onChange={setOrderByDraft}
          onSubmit={(text) => applyOrderBy(text.trim())}
          onClear={() => applyOrderBy('')}
          escapeFocusRef={gridRef}
          submitTitle="应用排序"
          label="ORDER BY"
          labelColor={orderByDraft === '' ? undefined : filesKeywordColor[theme]}
          extensions={languages.orderBy}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <RefreshButton
            refreshing={loading}
            title="刷新"
            onClick={() => setReload((n) => n + 1)}
          />
          {/* 导出整张表，带当前的筛选和排序 */}
          <ExportMenu
            fileName={ref.name}
            onExport={(format, file) =>
              window.api.exportDataSourceTable(tabKey, { table: ref, where, orderBy }, format, file)
            }
          />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {failure !== null && !loading ? (
          <CenteredHint error>{failure}</CenteredHint>
        ) : result === null ? (
          <LoadingHint />
        ) : (
          <DataGrid
            ref={gridRef}
            columns={result.columns}
            rows={result.rows}
            rowOffset={page * pageSize}
            sort={sort}
            onSort={(column) => applyOrderBy(nextHeaderOrderBy(dialect, orderBy, column))}
          />
        )}
      </div>
      <Paginator
        page={page}
        pageSize={pageSize}
        pageRows={result?.rows.length ?? 0}
        total={total}
        totalHint={totalHint}
        disabled={loading}
        onPage={setPage}
        onPageSize={(size) => {
          setPage(0)
          void setDataPageSize(size)
        }}
      />
    </div>
  )
}
