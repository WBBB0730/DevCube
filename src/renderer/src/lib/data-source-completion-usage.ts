// 补全的使用次数（pgcli 的 PrevalenceCounter，见 lib/sql-completion/prioritization）：登记的数据源各一个计数器，它的控制台、
// 表数据的 WHERE / ORDER BY 框与运行配置对话框的补全共用（pgcli 表结构变了重建补全器时，同样沿用原来的计数器）。控制台与
// 运行配置每成功执行一条语句，主进程推送过来（只推给主窗口），交给它计数，再整份存回主进程（跨重启保存，移除数据源时主进程
// 删掉）。第一次用到时读回存下的次数；计数先等读回，免得存回时盖掉存下的。
import { useMemo } from 'react'
import { PrevalenceCounter } from '@renderer/lib/sql-completion'
import type { DataSourceExecutedEvent } from '@shared/data-source-query'

interface Usage {
  counter: PrevalenceCounter
  /** 读回存下的次数 */
  loaded: Promise<void>
}

const usages = new Map<string, Usage>()

function usageOf(dataSourceId: string): Usage {
  let usage = usages.get(dataSourceId)
  if (usage === undefined) {
    const counter = new PrevalenceCounter()
    const loaded = window.api
      .getDataSourceCompletionUsage(dataSourceId)
      .then((saved) => counter.add(saved))
    usage = { counter, loaded }
    usages.set(dataSourceId, usage)
  }
  return usage
}

/**
 * 数据源补全的计数器（读回存下的次数之前按都没用过排）；Files 面板里直接打开的 SQLite 文件不是登记的数据源（null），
 * 没有计数器，不按使用次数排。
 */
export function useCompletionUsage(dataSourceId: string | null): PrevalenceCounter | undefined {
  return useMemo(
    () => (dataSourceId === null ? undefined : usageOf(dataSourceId).counter),
    [dataSourceId]
  )
}

/** 数据源执行成功了这些语句（主进程推送）：计数，再整份存回主进程。 */
export async function countExecutedStatements(event: DataSourceExecutedEvent): Promise<void> {
  const { counter, loaded } = usageOf(event.dataSourceId)
  await loaded
  for (const statement of event.statements) counter.update(statement, event.kind)
  await window.api.setDataSourceCompletionUsage(event.dataSourceId, counter.counts())
}
