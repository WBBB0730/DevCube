// Files 面板（与 Preview Window）里直接打开的 SQLite 文件（docs/prd/database.md「SQLite」）：正文区就是 Data Source Tab
// 那套视图，连的是临时数据源——不登记、不出现在左树；切到别的文件即关闭，控制台里写的内容、打开的对象与目录的展开都不
// 保留，也没有「最近打开」；文件被别的程序改写后不自动刷新，刷新目录时重新打开文件。打不开时同 Files 其他预览出错的
// 占位（盖满所在的格，调用方给 relative）。
import { useEffect, useState } from 'react'
import { FilesPreviewError } from '@renderer/components/files/FilesPreviewError'
import { LoadingHint } from '@renderer/components/ui/centered-hint'
import { useDataSourceSession } from '@renderer/lib/data-source-session'
import { DataSourceView } from './DataSourceView'

export function SqliteFileView({
  rootPath,
  filePath
}: {
  rootPath: string
  filePath: string
}): React.JSX.Element {
  // 每个面板各自一条会话（同一个文件可以同时开在项目的 Files Tab 与 Preview Window 里）
  const [tabKey] = useState(() => `sqlite-file:${crypto.randomUUID()}`)
  const state = useDataSourceSession(tabKey)
  const open = (): void => void window.api.openSqliteFileSession(tabKey, rootPath, filePath)

  useEffect(() => {
    void window.api.openSqliteFileSession(tabKey, rootPath, filePath)
    return () => void window.api.closeSqliteFileSession(tabKey)
  }, [tabKey, rootPath, filePath])

  if (state?.phase === 'connected') {
    return (
      <DataSourceView
        tabKey={tabKey}
        kind="sqlite"
        name={filePath.slice(filePath.lastIndexOf('/') + 1)}
        dataSourceId={null}
      />
    )
  }
  if (state?.phase === 'disconnected') {
    return (
      <FilesPreviewError
        title="无法打开此数据库"
        message={state.message}
        path={filePath}
        onRetry={open}
      />
    )
  }
  return <LoadingHint />
}
