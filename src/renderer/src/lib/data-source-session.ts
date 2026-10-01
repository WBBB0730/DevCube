// Data Source Tab 的连接状态（主进程推送；每个 Tab 一条连接，Tab 键即会话键）。
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import type { DataSourceSessionEvent, DataSourceSessionState } from '@shared/data-source'

// 各个 Data Source Tab 共用一个底层推送监听，按 Tab 键分发
const subscribeSession = createKeyedSubscription(
  window.api.onDataSourceSessionChanged,
  (event) => event.tabKey
)

const stateOf = (event: DataSourceSessionEvent): DataSourceSessionState => event.state

/**
 * 连接状态；首个推送或查询结果到达前为 null（尚未得知）——新开的 Tab 这时已在连接，不能先当作未连接。渲染端重载后接上
 * 主进程里已有的连接。
 */
export function useDataSourceSession(tabKey: string): DataSourceSessionState | null {
  return useKeyedPushed(tabKey, subscribeSession, window.api.getDataSourceSession, stateOf) ?? null
}
