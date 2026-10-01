// Redis 的「控制台」（docs/prd/database.md「Redis」）：一行一条命令（写法同 redis-cli），⌘↵ 执行光标所在的那行
// 或选中的各行，遇错即停；下面按 redis-cli 的样子列出这次执行的命令与回复。写的内容跨重启保留。行首补全命令名（服务器
// 的命令表，同 redis-cli 补成大写），不补键名。
// 执行了 SELECT 等切库的命令，主进程回查后推送，键列表顶栏的库编号下拉跟着变、键列表换库。执行与那个下拉的切换互斥
// （执行中不能切换，切换中不能执行）。
import { useCallback, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { CenteredHint } from '@renderer/components/ui/centered-hint'
import { useDataSourceUi } from '@renderer/data-source-store'
import { useConsoleText } from '@renderer/lib/console-text'
import { useConsoleBusy } from '@renderer/lib/data-source-context'
import { useRedisCommandCompletion } from '@renderer/lib/data-source-redis'
import { cn } from '@renderer/lib/utils'
import { redisCommandLines, redisRunSummary, type RedisCommandResult } from '@shared/redis'
import { ConsoleShell } from './ConsoleShell'

/** 上次执行的结果：各条命令的回复，或整个没能执行的原因。再执行时留着，新的到了才换。 */
type RunOutcome = { results: RedisCommandResult[] } | { error: string }

/** 要执行的命令：有选区时为选中的各行，否则为光标所在的那行；空行去掉。 */
function commandsToRun(view: EditorView): string[] {
  const { from, to, head } = view.state.selection.main
  return redisCommandLines(
    from === to ? view.state.doc.lineAt(head).text : view.state.sliceDoc(from, to)
  )
}

export function RedisConsole({ tabKey }: { tabKey: string }): React.JSX.Element {
  const [text, save] = useConsoleText(tabKey, true)
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const busy = useConsoleBusy(tabKey)
  const setBusy = useDataSourceUi((s) => s.setConsoleBusy)
  const commandCompletion = useRedisCommandCompletion(tabKey)
  const viewRef = useRef<EditorView | null>(null)

  const run = useCallback(async (): Promise<void> => {
    const view = viewRef.current
    if (view === null) return
    const commands = commandsToRun(view)
    if (commands.length === 0) return
    setBusy(tabKey, 'run')
    const next = await window.api.runRedisCommands(tabKey, commands)
    setBusy(tabKey, null)
    setOutcome(Array.isArray(next) ? { results: next } : { error: next.error })
  }, [tabKey, setBusy])

  const results = outcome !== null && 'results' in outcome ? outcome.results : null

  return (
    <ConsoleShell
      viewRef={viewRef}
      text={text}
      onChange={save}
      language={commandCompletion}
      running={busy === 'run'}
      disabled={busy !== null && busy !== 'run'}
      onRun={run}
      summary={results === null ? null : redisRunSummary(results)}
    >
      {outcome === null ? null : 'error' in outcome ? (
        <CenteredHint error>{outcome.error}</CenteredHint>
      ) : (
        <ReplyList results={outcome.results} />
      )}
    </ConsoleShell>
  )
}

/** 按 redis-cli 的样子逐条列出：命令与用时，其下回复（报错标红）。数据源上的配置的运行会话同样用它。 */
export function ReplyList({ results }: { results: RedisCommandResult[] }): React.JSX.Element {
  return (
    <div className="h-full select-text overflow-auto px-3 py-2 font-mono text-[12px]">
      {results.map((r, i) => (
        <div key={i} className="py-1">
          <div className="flex gap-3 text-foreground">
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
              {'> '}
              {r.command}
            </span>
            <span className="shrink-0 text-muted-foreground">{r.ms} 毫秒</span>
          </div>
          <pre
            className={cn(
              'whitespace-pre-wrap break-all',
              r.error ? 'text-[color:var(--status-failed)]' : 'text-muted-foreground'
            )}
          >
            {r.reply}
          </pre>
        </div>
      ))}
    </div>
  )
}
