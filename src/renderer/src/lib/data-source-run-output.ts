// 数据源上的配置的运行结果（主进程持有，执行完一次推送；键即运行会话键）。
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import type { DataSourceRunOutput, DataSourceRunOutputEvent } from '@shared/data-source-run'

// 各个运行会话共用一个底层推送监听，按会话键分发
const subscribeOutput = createKeyedSubscription(
  window.api.onDataSourceRunOutput,
  (event) => event.key
)

const outputOf = (event: DataSourceRunOutputEvent): DataSourceRunOutput | null => event.output

/**
 * 运行结果；null 为还没有结果（连接中、等密码或执行中），undefined 为尚未得知（首个推送或查询结果到达前）。渲染端重载、
 * 操作栏重新挂上时取回主进程持有的结果。
 */
export function useDataSourceRunOutput(key: string): DataSourceRunOutput | null | undefined {
  return useKeyedPushed(key, subscribeOutput, window.api.getDataSourceRunOutput, outputOf)
}
