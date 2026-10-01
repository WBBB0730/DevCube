// Data Source Tab 的「控制台」（docs/prd/database.md「控制台」）：上面写语句（按方言高亮，按表名、列名补全，可格式化），
// ⌘↵ 执行光标所在的那条或选中的各条；下面是结果——最后一个结果集分页显示，或各条语句的影响行数与报错。
// 工具栏右端是「库」「模式」两个 combobox（MySQL / MariaDB 只有「库」，SQLite 没有，见 ConsoleContextComboboxes；「库」只列
// 显示的库）：控制台在哪个库、哪个模式上执行以主进程回查到的为准，从它们切换、控制台里 USE / SET search_path 之后都跟着
// 变。执行与切换互斥（执行中不能切换，切换中不能执行）。
// 写的内容跨重启保留；执行了改结构或结束事务的语句后通知目录与补全重读（事务里改的结构提交后，重读才以它为准）。
// 补全交给补全引擎（lib/sql-completion）：范围跟着控制台所在的库（PostgreSQL 按库各一份）与不写前缀时查找的模式或库，
// 表结构由 Data Source Tab 读好交来（与表数据的 WHERE / ORDER BY 框共用，见 useConsoleCompletion）；用得多的排前（按数据源
// 计数，见 useCompletionUsage）。
import { useCallback, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { WandSparkles } from 'lucide-react'
import { CenteredHint } from '@renderer/components/ui/centered-hint'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { useDataSourceUi } from '@renderer/data-source-store'
import { useConsoleText } from '@renderer/lib/console-text'
import { useConsoleBusy } from '@renderer/lib/data-source-context'
import { formatSqlInEditor } from '@renderer/lib/data-source-sql'
import { sqlLanguage, type PrevalenceCounter } from '@renderer/lib/sql-completion'
import { statementsToRun } from '@renderer/lib/sql-statements'
import type { SqlKind } from '@shared/data-source'
import type { ConsoleContext } from '@shared/data-source-context'
import {
  consoleRunResult,
  consoleRunSummary,
  isSchemaChange,
  isTransactionEnd,
  queryFailureText,
  type CompletionSchema,
  type ConsoleRun
} from '@shared/data-source-query'
import { ConsoleContextComboboxes } from './ConsoleContextDropdown'
import { ConsoleResultView } from './ConsoleResultView'
import { ConsoleShell } from './ConsoleShell'
import { ResultExportMenu } from './ExportMenu'

/** 上次执行的结果：各条语句的结果，或整个没能执行的原因。再执行时留着，新的到了才换。 */
type RunOutcome = { run: ConsoleRun } | { error: string }

export function ConsoleView({
  tabKey,
  kind,
  context,
  shownDatabases,
  persist,
  completion,
  prioritizer,
  onSchemaChange
}: {
  tabKey: string
  kind: SqlKind
  /** 控制台上下文（Data Source Tab 读一份交来，见 useConsoleContext）：尚未得知为 undefined，没有（SQLite）为 null */
  context: ConsoleContext | null | undefined
  /** 显示的库（PostgreSQL、MySQL / MariaDB）：「库」只列它们 */
  shownDatabases?: readonly string[]
  /** 写的内容跨重启保留（Files 面板里直接打开的 SQLite 文件不保留） */
  persist: boolean
  /** 补全用的表结构（跟着控制台上下文，见 useConsoleCompletion）；还没有为 null */
  completion: CompletionSchema | null
  /** 补全的使用次数（见 useCompletionUsage）；Files 面板里直接打开的 SQLite 文件没有 */
  prioritizer: PrevalenceCounter | undefined
  /** 执行了改结构或结束事务的语句 */
  onSchemaChange: () => void
}): React.JSX.Element {
  const [text, save] = useConsoleText(tabKey, persist)
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const busy = useConsoleBusy(tabKey)
  const setBusy = useDataSourceUi((s) => s.setConsoleBusy)
  // 格式化失败的原因：弹错误框，点「确定」清掉
  const [formatError, setFormatError] = useState<string | null>(null)
  // 取消失败的原因（如叫停用的连接连不上）：弹错误框，点「确定」清掉
  const [cancelError, setCancelError] = useState<string | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // 按方言高亮；补全交给补全引擎，表结构取不到时只补关键字、内置函数与类型
  const language = useMemo(
    () => sqlLanguage(kind, { metadata: completion, prioritizer }),
    [kind, completion, prioritizer]
  )

  const run = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    if (view === null) return
    const statements = statementsToRun(view.state, kind)
    if (statements.length === 0) return
    setBusy(tabKey, 'run')
    const next = await window.api.runDataSourceConsole(tabKey, statements)
    setBusy(tabKey, null)
    if ('statements' in next) {
      setOutcome({ run: next })
      const changed = next.statements.some(
        (s) =>
          s.outcome.kind !== 'error' &&
          s.outcome.kind !== 'canceled' &&
          (isSchemaChange(s.sql) || isTransactionEnd(s.sql))
      )
      if (changed) onSchemaChange()
    } else {
      setOutcome({ error: queryFailureText(next, '无权执行') })
    }
  }, [tabKey, kind, onSchemaChange, setBusy])

  const cancel = async (): Promise<void> => {
    const failure = await window.api.cancelDataSourceConsole(tabKey)
    if (failure !== null) setCancelError(queryFailureText(failure, '无权取消'))
  }

  const format = (): void => {
    const view = viewRef.current
    if (view === null) return
    const failure = formatSqlInEditor(view, kind)
    if (failure !== null) setFormatError(failure)
  }

  const done = outcome !== null && 'run' in outcome ? outcome.run : null
  const result = done === null ? null : consoleRunResult(done).result

  return (
    <>
      <ConsoleShell
        viewRef={viewRef}
        text={text}
        onChange={save}
        language={language}
        running={busy === 'run'}
        disabled={busy !== null && busy !== 'run'}
        onRun={run}
        onCancel={cancel}
        actions={
          <>
            <button type="button" title="格式化" className={TOOLBAR_BTN} onClick={format}>
              <WandSparkles className="size-4" />
            </button>
            <ResultExportMenu kind={kind} result={result} />
          </>
        }
        summary={done === null ? null : consoleRunSummary(done)}
        context={
          context == null || context.kind === 'redis' ? undefined : (
            <ConsoleContextComboboxes
              tabKey={tabKey}
              context={context}
              shownDatabases={shownDatabases}
            />
          )
        }
      >
        {outcome === null ? null : 'error' in outcome ? (
          <CenteredHint error>{outcome.error}</CenteredHint>
        ) : (
          <ConsoleResultView run={outcome.run} />
        )}
      </ConsoleShell>
      {formatError !== null && (
        <ErrorDialog
          title="无法格式化"
          message={formatError}
          onClose={() => setFormatError(null)}
        />
      )}
      {cancelError !== null && (
        <ErrorDialog
          title="无法取消执行"
          message={cancelError}
          onClose={() => setCancelError(null)}
        />
      )}
    </>
  )
}
