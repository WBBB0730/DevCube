// 数据源的界面共享状态（docs/prd/database.md「最近打开」「控制台」）：各数据源最近打开的对象或键（它的各个 Tab 共用，改动
// 经主进程落盘），⌘E 弹出某个 Data Source Tab 的「最近打开」下拉，与各 Tab 的控制台上下文正被什么占着（执行与切换互斥）。
// 数据源的连接信息被改时主进程已忘掉它的最近打开，这里读过的也丢掉，下次用到重新读。
import { create } from 'zustand'
import { dataSourceConnectionChanged } from '@shared/data-source'
import type { ConsoleContextLevel } from '@shared/data-source-context'
import { isResidentDataSourceTabKey, residentDataSourceTabKey } from '@shared/runnable'
import type { DataSourceOpened } from '@shared/data-source-ui'
import { resolveTabs, useApp } from '@renderer/store'

/**
 * 控制台上下文正被占着：控制台执行中（run），或正在切换控制台上下文，记下要变的各级——库（database，SQL 控制台工具栏的
 * 「库」、Redis 的库编号下拉与最近打开）、模式（schema，「模式」）；目录右键「在控制台中打开」按要切到的算，跨库切模式时
 * 两级都变（见 consoleContextChangeLevels）
 */
export type ConsoleBusy = 'run' | ConsoleContextLevel[]

interface DataSourceUiStore {
  /** 各数据源最近打开的对象或键（按数据源 id，新→旧）；还没读到的没有这一项 */
  recents: Record<string, DataSourceOpened[]>
  /** +1 驱动这个 Data Source Tab 弹出「最近打开」下拉（⌘E / Ctrl+E）；键为 Tab 键 */
  recentMenuNonceByTab: Record<string, number>
  /**
   * 各 Data Source Tab 的控制台上下文正被什么占着（键为 Tab 键；没被占着的没有这一项）。执行与切换互斥：执行中不能切换，
   * 切换中不能执行，免得语句落在切换前后不定的库上（Redis 的库编号下拉在键列表里、与控制台分处两格，经这里互知）
   */
  consoleBusyByTab: Record<string, ConsoleBusy>
  /** 读数据源的最近打开（读过的不再读） */
  loadRecents: (dataSourceId: string) => void
  /** 打开了一个对象或键：放到最近打开的最前（主进程去重、截断并落盘） */
  pushRecent: (dataSourceId: string, opened: DataSourceOpened) => void
  /** 已不在的从最近打开里去掉 */
  dropRecent: (dataSourceId: string, opened: DataSourceOpened) => void
  /** 数据源条目按 ⌘E：当前激活的 Data Source Tab（激活的不是时为常驻的那个）切过去并弹出「最近打开」下拉 */
  openRecentMenu: (entryKey: string) => void
  /** 占着（开始执行、开始切换）或放开（null，结束了） */
  setConsoleBusy: (tabKey: string, busy: ConsoleBusy | null) => void
}

export const useDataSourceUi = create<DataSourceUiStore>((set, get) => {
  const setRecents = (dataSourceId: string, recents: DataSourceOpened[]): void =>
    set((s) => ({ recents: { ...s.recents, [dataSourceId]: recents } }))
  return {
    recents: {},
    recentMenuNonceByTab: {},
    consoleBusyByTab: {},
    loadRecents: (dataSourceId) => {
      if (Object.hasOwn(get().recents, dataSourceId)) return
      void window.api.getDataSourceRecents(dataSourceId).then((recents) => {
        // 读的这会儿已经打开过别的（列表由 push 交回），以那份为准
        if (!Object.hasOwn(get().recents, dataSourceId)) setRecents(dataSourceId, recents)
      })
    },
    pushRecent: (dataSourceId, opened) => {
      void window.api
        .pushDataSourceRecent(dataSourceId, opened)
        .then((recents) => setRecents(dataSourceId, recents))
    },
    dropRecent: (dataSourceId, opened) => {
      void window.api
        .dropDataSourceRecent(dataSourceId, opened)
        .then((recents) => setRecents(dataSourceId, recents))
    },
    openRecentMenu: (entryKey) => {
      const app = useApp.getState()
      const { activeKey } = resolveTabs(app, entryKey)
      const onDataSourceTab =
        activeKey !== null &&
        (isResidentDataSourceTabKey(activeKey) ||
          app.terminals.some((t) => t.key === activeKey && t.dataSourceId !== undefined))
      const tabKey = onDataSourceTab ? activeKey : residentDataSourceTabKey(entryKey)
      set((s) => ({
        recentMenuNonceByTab: {
          ...s.recentMenuNonceByTab,
          [tabKey]: (s.recentMenuNonceByTab[tabKey] ?? 0) + 1
        }
      }))
      app.activateTab(entryKey, tabKey)
    },
    setConsoleBusy: (tabKey, busy) =>
      set((s) => {
        const next = { ...s.consoleBusyByTab }
        if (busy === null) delete next[tabKey]
        else next[tabKey] = busy
        return { consoleBusyByTab: next }
      })
  }
})

// 连接信息被改（连到别的库、换了类型；同主进程删表结构缓存的条件）的数据源：丢掉读过的最近打开
useApp.subscribe((state, prev) => {
  if (state.dataSources === prev.dataSources) return
  const before = new Map(prev.dataSources.map((n) => [n.dataSource.id, n.dataSource.target]))
  const changed = state.dataSources.flatMap(({ dataSource }) => {
    const target = before.get(dataSource.id)
    return target !== undefined && dataSourceConnectionChanged(target, dataSource.target)
      ? [dataSource.id]
      : []
  })
  if (changed.length === 0) return
  useDataSourceUi.setState((s) => ({
    recents: Object.fromEntries(Object.entries(s.recents).filter(([id]) => !changed.includes(id)))
  }))
})
