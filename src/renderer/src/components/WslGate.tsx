// WSL 项目（docs/prd/wsl-project.md）的 Git / Files 面板外壳：第一次连上发行版之前不挂载面板（挂载即读文件、跑 git，
// 会唤醒发行版），显示连接占位页——连接中转圈「正在连接…」，连不上时原因 +「重新连接」；没有「连接」按钮，
// 点开项目即连。连上过一次后一直显示面板：之后闲置断开、重连都不卸载（展开状态与编辑都在），用到时自会重新连上。
// 不是 WSL 项目时原样渲染。
import { useState } from 'react'
import { ConnectPlaceholder } from '@renderer/components/ui/connect-placeholder'
import { createKeyedSubscription, useKeyedPushed } from '@renderer/lib/keyed-subscription'
import type { WslConnectionState, WslStateEvent } from '@shared/wsl'
import { wslDistroOf } from '@shared/wsl-path'

// 各面板共用一个底层推送监听，按发行版分发（发行版名不分大小写）
const subscribeWslState = createKeyedSubscription(window.api.onWslStateChanged, (event) =>
  event.distro.toLowerCase()
)

const stateOf = (event: WslStateEvent): WslConnectionState => event.state

export function WslGate({
  projectPath,
  children
}: {
  projectPath: string
  children: React.ReactNode
}): React.ReactNode {
  const distro = wslDistroOf(projectPath)
  if (distro === null) return children
  return <WslGateFor distro={distro}>{children}</WslGateFor>
}

function WslGateFor({
  distro,
  children
}: {
  distro: string
  children: React.ReactNode
}): React.ReactNode {
  // 按小写的发行版名取（主进程同样不分大小写）；取值函数用稳定引用，免得每次渲染都重新订阅
  const state = useKeyedPushed(
    distro.toLowerCase(),
    subscribeWslState,
    window.api.getWslState,
    stateOf
  )
  const [ready, setReady] = useState(false)
  // 渲染中调整 state：连上的那一刻起改显示面板（之后不再回到占位页）
  if (!ready && state?.status === 'connected') setReady(true)
  if (ready || state?.status === 'connected') return children
  if (state?.status === 'failed') {
    return (
      <ConnectPlaceholder
        phase="failed"
        message={state.reason}
        actionLabel="重新连接"
        onAction={() => void window.api.reconnectWsl(distro)}
      />
    )
  }
  // 未连接即将连（当前条目一选中就连）：与连接中同样显示
  return <ConnectPlaceholder phase="connecting" />
}
