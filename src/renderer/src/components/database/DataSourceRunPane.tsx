// 数据源上的配置的运行会话（docs/prd/database.md「运行配置」）：正文不是终端，是这次运行的结果——主进程持有、执行完一次
// 推送，显示同控制台的结果区（SQL 为表格或语句列表，Redis 为 redis-cli 式的记录）；整个没能执行时居中写明原因。
// 还没有结果时看连接（每次运行一条自己的连接，键即运行会话键）：连接中与密码被拒时同 Data Source Tab 的未连接页，
// 页内出密码框，交上来即带着密码重跑；连上了即在执行。
// 运行结束、被重跑取代时主进程断开连接并推送未连接（结束时先交回结果），渲染端不留上一次的连接状态；判断时先看结果，
// 再看运行状态，最后才看连接。
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import { useDataSourceRunOutput } from '@renderer/lib/data-source-run-output'
import { useDataSourceSession } from '@renderer/lib/data-source-session'
import { useApp } from '@renderer/store'
import type { DataSourceNode, DataSourceSessionState, SqlKind } from '@shared/data-source'
import { consoleRunResult } from '@shared/data-source-query'
import { ConsoleResultView } from './ConsoleResultView'
import { DataSourceConnectForm } from './DataSourceConnectForm'
import { ResultExportMenu } from './ExportMenu'
import { ReplyList } from './RedisConsole'

const CONNECTING = { phase: 'connecting' } satisfies DataSourceSessionState

export function DataSourceRunPane({
  sessionKey,
  entryKey,
  configId,
  node,
  visible
}: {
  /** 运行会话键（即配置键） */
  sessionKey: string
  /** 配置所属的左树条目（`datasource:<id>`） */
  entryKey: string
  configId: string
  /** 配置所在的数据源 */
  node: DataSourceNode
  visible: boolean
}): React.JSX.Element {
  const status = useApp((s) => s.sessions[sessionKey]?.status)
  const run = useApp((s) => s.run)
  // undefined = 尚未得知；null = 还没有结果（连接中、等密码或执行中）
  const output = useDataSourceRunOutput(sessionKey)
  const conn = useDataSourceSession(sessionKey)

  let body: React.ReactNode = null
  if (output === null) {
    if (status === 'running' && conn !== null) {
      body =
        conn.phase === 'connected' ? (
          <LoadingHint label="正在执行…" />
        ) : (
          // 连接中与等密码之间保持同一个实例（密码框的输入与勾选、上一次给没给密码都在里面）；
          // 运行中除了密码被拒，别的连接状态都按连接中：未连接是刚开始、主进程还没推送连接中，连不上的随即以失败
          // 结束、结果马上就到，都不在这里闪一下未连接页或失败页
          <DataSourceConnectForm
            node={node}
            state={conn.phase === 'disconnected' && conn.passwordRejected ? conn : CONNECTING}
            visible={visible}
            onConnect={(password) =>
              void run(
                { type: 'config', id: configId },
                sessionKey,
                entryKey,
                password ?? undefined
              )
            }
          />
        )
    }
  } else if (output !== undefined) {
    body =
      output.kind === 'error' ? (
        <CenteredHint error>{output.message}</CenteredHint>
      ) : output.kind === 'sql' ? (
        <ConsoleResultView run={output.run} />
      ) : (
        <ReplyList results={output.results} />
      )
  }

  return <div className="h-full bg-deepest">{body}</div>
}

/**
 * 运行会话操作栏里的「导出」（SQL 类型的数据源上的配置才有，代替「清空输出」）：导出这次运行取回的结果集，同控制台的
 * 导出；没有结果集、有语句出错时不可用。
 */
export function DataSourceRunExport({
  sessionKey,
  kind
}: {
  sessionKey: string
  kind: SqlKind
}): React.JSX.Element {
  const output = useDataSourceRunOutput(sessionKey)
  return (
    <ResultExportMenu
      kind={kind}
      result={output?.kind === 'sql' ? consoleRunResult(output.run).result : null}
    />
  )
}
