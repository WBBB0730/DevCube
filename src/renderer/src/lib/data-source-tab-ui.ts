// Data Source Tab 记住的界面状态（docs/prd/database.md「记住上次打开的」）：停在哪一格、上次打开的对象或键、目录的展开，
// 跨重启保留，连上后恢复。登记的数据源的 Tab 才记；Files 面板里直接打开的 SQLite 文件不记。
// 关 Tab（与移除所在的项目或数据源）时主进程连同控制台内容一并删掉（见 main 的 store）。
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DATA_SOURCE_TAB_UI, type DataSourceTabUi } from '@shared/data-source-ui'

/**
 * 这个 Tab 记住的界面状态（读到之前为 null）与记下改动的函数（只写改了的几项）。persist 为 false 时不读也不写，
 * 一律按默认。
 */
export function useDataSourceTabUi(
  tabKey: string,
  persist: boolean
): { saved: DataSourceTabUi; save: (patch: Partial<DataSourceTabUi>) => void } | null {
  // 连同它所属的 Tab 键一起存：键变了而状态还是旧的，即还没读到
  const [loaded, setLoaded] = useState<{ tabKey: string; ui: DataSourceTabUi } | null>(null)

  useEffect(() => {
    if (!persist) return
    let current = true
    void window.api.getDataSourceTabUi(tabKey).then((ui) => {
      if (current) setLoaded({ tabKey, ui })
    })
    return () => {
      current = false
    }
  }, [tabKey, persist])

  const save = useCallback(
    (patch: Partial<DataSourceTabUi>): void => {
      if (persist) void window.api.setDataSourceTabUi(tabKey, patch)
    },
    [tabKey, persist]
  )

  if (!persist) return { saved: DEFAULT_DATA_SOURCE_TAB_UI, save }
  return loaded?.tabKey === tabKey ? { saved: loaded.ui, save } : null
}
