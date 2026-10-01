// 一次执行的结果区（docs/prd/database.md「控制台」「运行配置」；控制台与数据源上的配置的运行会话共用）：有语句出错时居中
// 报错；否则有结果集时分页显示最后一个结果集（本地分页，每页行数同表格）；否则列出各条语句的影响行数与用时。
import { useMemo, useState } from 'react'
import { CenteredHint } from '@renderer/components/ui/centered-hint'
import { useApp } from '@renderer/store'
import {
  consoleRunResult,
  statementOutcomeText,
  type ConsoleRun,
  type ConsoleStatementResult
} from '@shared/data-source-query'
import { DataGrid } from './DataGrid'
import { Paginator } from './Paginator'

export function ConsoleResultView({ run }: { run: ConsoleRun }): React.JSX.Element {
  const pageSize = useApp((s) => s.dataPageSize)
  const setDataPageSize = useApp((s) => s.setDataPageSize)
  // 页码连同它所属的那次结果一起存：换了一次结果即回到第一页
  const [paged, setPaged] = useState<{ run: ConsoleRun; page: number } | null>(null)
  const page = paged?.run === run ? paged.page : 0
  const { failed, result } = useMemo(() => consoleRunResult(run), [run])
  // 当前页的行只在结果、页码、每页行数变了时重取：每次渲染都是新数组时，表格的选区与查找进度会被重置
  const rows = useMemo(
    () => result?.rows.slice(page * pageSize, (page + 1) * pageSize) ?? [],
    [result, page, pageSize]
  )

  if (failed !== null) {
    return <CenteredHint error>{statementOutcomeText(failed)}</CenteredHint>
  }
  if (result === null) return <StatementList statements={run.statements} />
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <DataGrid columns={result.columns} rows={rows} rowOffset={page * pageSize} />
      </div>
      <Paginator
        page={page}
        pageSize={pageSize}
        pageRows={rows.length}
        total={result.rows.length}
        onPage={(next) => setPaged({ run, page: next })}
        onPageSize={(size) => {
          setPaged({ run, page: 0 })
          void setDataPageSize(size)
        }}
      />
    </div>
  )
}

/** 没有结果集时：各条语句（第一行）与它的结果。 */
function StatementList({
  statements
}: {
  statements: ConsoleStatementResult[]
}): React.JSX.Element {
  return (
    <div className="h-full select-text overflow-auto px-3 py-2 font-mono text-[12px]">
      {statements.map((s, i) => (
        <div key={i} className="flex gap-3 py-0.5">
          <span className="min-w-0 flex-1 truncate text-foreground" title={s.sql}>
            {s.sql.split('\n')[0]}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {statementOutcomeText(s)} · {s.ms} 毫秒
          </span>
        </div>
      ))}
    </div>
  )
}
