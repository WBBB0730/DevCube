// 服务器的 Files Tab 正文（docs/prd/server-files.md）：每台服务器常驻一个，切走仅隐藏。
// 未连接时同 Status Tab 的样式（「尚未连接到 X」+「连接」）；连上后是 Files 面板（server 宿主，根为 `/`），
// 底部一条传输栏。意外断开时面板保留（未保存的编辑还在），顶部提示原因与「重新连接」；
// 手动断开、服务器被编辑或移除才回到未连接。
import { useMemo, useState } from 'react'
import { Download, LoaderCircle, Upload, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ConnectPlaceholder } from '@renderer/components/ui/connect-placeholder'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { FilesPane, type FilesPaneHost } from '@renderer/components/files/FilesPane'
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import { useServerFilesState } from '@renderer/lib/server-files-state'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'
import type { ServerTransfer, ServerTransfersEvent } from '@shared/server-files'
import { formatBytes } from '@shared/server-status'
import { serverEntryKey } from '@shared/tree-entry'

// 各台服务器的文件面板共用底层推送监听，按服务器 id 分发
const subscribeServerTransfers = createKeyedSubscription(
  window.api.onServerTransfersChanged,
  (event) => event.serverId
)

const transfersOf = (event: ServerTransfersEvent): ServerTransfer[] => event.transfers

const NO_TRANSFERS: ServerTransfer[] = []

export function ServerFilesPane({
  serverId,
  visible
}: {
  serverId: string
  visible: boolean
}): React.JSX.Element {
  const entryKey = serverEntryKey(serverId)
  const name = useApp((s) => s.servers.find((n) => n.server.id === serverId)?.server.name ?? '')
  // 渲染端重载后接上主进程里已有的连接与传输；尚未得知时按未连接、没有传输
  const state = useServerFilesState(serverId)
  const transfers =
    useKeyedPushed(
      serverId,
      subscribeServerTransfers,
      window.api.getServerTransfers,
      transfersOf
    ) ?? NO_TRANSFERS
  /** 连上过的家目录：有它面板就留着（意外断开也不卸），手动断开 / 编辑服务器（回到未连接）才清掉 */
  const [home, setHome] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  if (state.phase === 'connected' && home !== state.home) setHome(state.home)
  if (state.phase === 'idle' && home !== null) setHome(null)

  const connect = (): void => void window.api.connectServerFiles(serverId)
  const activeTransfers = transfers.filter((t) => t.status !== 'failed').length
  const connected = state.phase === 'connected'

  const host = useMemo<FilesPaneHost | null>(
    () =>
      home === null
        ? null
        : {
            kind: 'server',
            serverId,
            entryKey,
            home,
            connected,
            // 有传输进行中时先确认：断开会中止它们
            onDisconnect: () => {
              if (activeTransfers > 0) setConfirmDisconnect(true)
              else void window.api.disconnectServerFiles(serverId)
            },
            onOpenInSshTerminal: (dir) =>
              void useApp.getState().newSshTerminal(entryKey, serverId, dir)
          },
    [home, serverId, entryKey, connected, activeTransfers]
  )

  if (host === null) {
    if (state.phase === 'connecting') return <ConnectPlaceholder phase="connecting" />
    if (state.phase === 'disconnected') {
      return (
        <ConnectPlaceholder
          phase="failed"
          message={state.message}
          actionLabel="重新连接"
          onAction={connect}
        />
      )
    }
    // 其余即未连接（刚连上那一刻 home 尚未补上，这次渲染会因上面的 setHome 随即重来）
    return (
      <ConnectPlaceholder
        phase="idle"
        message={name === '' ? '尚未连接' : `尚未连接到 ${name}`}
        actionLabel="连接"
        onAction={connect}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!connected && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--separator)] bg-panel px-3 text-[13px]">
          {state.phase === 'connecting' ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在重新连接…
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[var(--status-failed)]">
                连接已断开{state.phase === 'disconnected' ? `：${state.message}` : ''}
              </span>
              <Button size="sm" onClick={connect}>
                重新连接
              </Button>
            </>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <FilesPane rootPath="/" visible={visible} host={host} />
      </div>
      <TransferBar serverId={serverId} transfers={transfers} />
      {confirmDisconnect && (
        <FormDialogShell
          message={`还有 ${activeTransfers} 个文件传输未完成，断开连接将中止这些传输。`}
          buttons={[
            {
              label: '断开连接',
              onClick: () => {
                setConfirmDisconnect(false)
                void window.api.disconnectServerFiles(serverId)
              }
            }
          ]}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </div>
  )
}

/** 传输栏：进行中与排队的上传 / 下载（可取消），失败的留下原因直到关掉；全部完成后收起。 */
function TransferBar({
  serverId,
  transfers
}: {
  serverId: string
  transfers: ServerTransfer[]
}): React.JSX.Element | null {
  if (transfers.length === 0) return null
  return (
    <div className="max-h-40 shrink-0 overflow-y-auto border-t border-[var(--separator)] bg-panel px-1.5 py-1">
      {transfers.map((t) => (
        <TransferRow key={t.id} serverId={serverId} transfer={t} />
      ))}
    </div>
  )
}

function TransferRow({
  serverId,
  transfer
}: {
  serverId: string
  transfer: ServerTransfer
}): React.JSX.Element {
  const failed = transfer.status === 'failed'
  const ratio =
    transfer.totalBytes !== null && transfer.totalBytes > 0
      ? Math.min(1, transfer.doneBytes / transfer.totalBytes)
      : 0
  const detail = failed
    ? (transfer.error ?? '传输失败')
    : transfer.status === 'queued'
      ? '等待中'
      : transfer.totalBytes === null
        ? '正在清点…'
        : `${formatBytes(transfer.doneBytes)} / ${formatBytes(transfer.totalBytes)}`
  const Icon = transfer.direction === 'upload' ? Upload : Download
  return (
    <div className="flex h-8 items-center gap-2 rounded px-1.5 text-[13px]">
      <Icon className="size-3.5 shrink-0 text-[color:var(--fg-icon)]" />
      <span className="min-w-0 max-w-[40%] shrink truncate text-foreground" title={transfer.name}>
        {transfer.name}
      </span>
      {transfer.status === 'running' && transfer.totalBytes !== null && (
        <div className="h-1 w-32 shrink-0 overflow-hidden rounded-full bg-[var(--bg-row-hover)]">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs tabular-nums',
          failed ? 'text-[var(--status-failed)]' : 'text-muted-foreground'
        )}
        title={detail}
      >
        {detail}
      </span>
      <button
        type="button"
        title={failed ? '关闭' : '取消'}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]"
        onClick={() =>
          void (failed
            ? window.api.dismissServerTransfer(serverId, transfer.id)
            : window.api.cancelServerTransfer(serverId, transfer.id))
        }
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
