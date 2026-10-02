// 服务器的文件连接状态（docs/prd/server-files.md）：主进程持有、按服务器推送。Files Tab 与选目录对话框共用。
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import type { ServerFilesState, ServerFilesStateEvent } from '@shared/server-files'

// 各处共用底层推送监听，按服务器 id 分发
const subscribeServerFiles = createKeyedSubscription(
  window.api.onServerFilesStateChanged,
  (event) => event.serverId
)

const stateOf = (event: ServerFilesStateEvent): ServerFilesState => event.state

const IDLE: ServerFilesState = { phase: 'idle' }

/** 某台服务器的文件连接状态：渲染端重载后接上主进程里已有的连接；尚未得知时按未连接。 */
export function useServerFilesState(serverId: string): ServerFilesState {
  return (
    useKeyedPushed(serverId, subscribeServerFiles, window.api.getServerFilesState, stateOf) ?? IDLE
  )
}
