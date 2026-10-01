// Data Source Tab 的正文（术语见 CONTEXT.md，产品范围见 docs/prd/database.md）：常驻的与另开的共用，切走仅隐藏。
// 连接状态由主进程推送（每个 Tab 一条连接）：另开的新开即连接，常驻的与跨重启恢复的点「连接」才连。
// 没连上时（未连接 / 连接中 / 失败，要密码时页面里出密码框）见 DataSourceConnectForm。
// PostgreSQL、MySQL / MariaDB 连上后按显示的库列目录（数据源登记里记着，从没设置过时为连上后的默认库，见
// catalogShownDatabases），目录根行勾选即记回数据源，它的各个 Tab 一样。
import { useMemo } from 'react'
import { useDataSourceSession } from '@renderer/lib/data-source-session'
import { useApp } from '@renderer/store'
import { catalogShownDatabases } from '@shared/data-source-catalog'
import { DataSourceConnectForm } from './DataSourceConnectForm'
import { DataSourceView } from './DataSourceView'
import { RedisView } from './RedisView'

export function DataSourcePane({
  tabKey,
  dataSourceId,
  visible
}: {
  tabKey: string
  dataSourceId: string
  visible: boolean
}): React.JSX.Element {
  const node = useApp((s) => s.dataSources.find((n) => n.dataSource.id === dataSourceId))
  const setShownDatabases = useApp((s) => s.setDataSourceShownDatabases)
  // null = 尚未得知：新开的 Tab 已在连接，要等主进程回话才知道
  const state = useDataSourceSession(tabKey)
  const saved = node?.dataSource.shownDatabases
  const database = state?.phase === 'connected' ? state.database : ''
  // 同一份不变时保持同一个数组（目录据它重算根这一层）
  const shownDatabases = useMemo(() => catalogShownDatabases(saved, database), [saved, database])

  // 尚未得知连接状态时留白，免得新开即连接的 Tab 先闪一下未连接页（没记住密码时还带密码框）
  if (!node || state === null) return <div className="h-full" />
  const { dataSource } = node

  if (state.phase === 'connected') {
    const disconnect = (): void => void window.api.disconnectDataSourceSession(tabKey)
    return dataSource.target.kind === 'redis' ? (
      <RedisView
        tabKey={tabKey}
        dataSourceId={dataSourceId}
        name={dataSource.name}
        onDisconnect={disconnect}
      />
    ) : (
      <DataSourceView
        tabKey={tabKey}
        kind={dataSource.target.kind}
        name={dataSource.name}
        dataSourceId={dataSourceId}
        shown={
          // SQLite 只有一个库，没有显示的库
          dataSource.target.kind === 'sqlite'
            ? undefined
            : {
                databases: shownDatabases,
                onChange: (databases) => void setShownDatabases(dataSourceId, databases)
              }
        }
        onDisconnect={disconnect}
      />
    )
  }
  return (
    <DataSourceConnectForm
      node={node}
      state={state}
      visible={visible}
      onConnect={(password) =>
        void window.api.connectDataSourceSession(tabKey, dataSourceId, password)
      }
    />
  )
}
