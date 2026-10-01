// Data Source Tab 内容区顶栏的「最近打开」（docs/prd/database.md「最近打开」）：这个数据源最近打开的对象（Redis 为键），
// 它的各个 Tab 共用；样式同 Files 的最近打开文件（ui/recent-menu），每项为对象名加淡色的「库.模式」（键为淡色的库编号，
// 库编号未知时记下的没有），点即打开。
// ⌘E 经 data-source-store 弹出，只认挂载之后按的（没连上时按的不补）；⌘E 弹出的被 Esc 关掉时焦点回正文（同 Files）。
import { useEffect, useState } from 'react'
import { RecentMenu, type RecentMenuItem } from '@renderer/components/ui/recent-menu'
import { useDataSourceUi } from '@renderer/data-source-store'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { openedKey, openedLocation, type DataSourceOpened } from '@shared/data-source-ui'
import { SHORTCUT } from '@shared/shortcut-label'

const NO_RECENTS: DataSourceOpened[] = []

/** 最近打开里的一项：名称、淡色的位置与悬停说明。 */
function itemOf(opened: DataSourceOpened): RecentMenuItem {
  const location = openedLocation(opened)
  if (opened.kind === 'key') {
    return { key: openedKey(opened), name: opened.key, location, title: opened.key }
  }
  const full = location === '' ? opened.name : `${location}.${opened.name}`
  return {
    key: openedKey(opened),
    name: opened.name,
    location,
    title: opened.detail === undefined ? full : `${full} ${opened.detail}`
  }
}

export function DataSourceRecentMenu<K extends DataSourceOpened['kind']>({
  tabKey,
  dataSourceId,
  kind,
  current,
  onOpen,
  onFocusContent
}: {
  tabKey: string
  dataSourceId: string
  /** 列哪一类：SQL 数据库为对象，Redis 为键（数据源改过类型时，另一类的旧记录不列） */
  kind: K
  /** 当前打开着的（⌘E 打开时跳过它预选下一项） */
  current: Extract<DataSourceOpened, { kind: K }> | null
  onOpen: (opened: Extract<DataSourceOpened, { kind: K }>) => void
  /** 焦点回正文（⌘E 弹出的下拉被 Esc 关掉时） */
  onFocusContent: () => void
}): React.JSX.Element {
  const recents = useDataSourceUi((s) => s.recents[dataSourceId] ?? NO_RECENTS)
  const loadRecents = useDataSourceUi((s) => s.loadRecents)
  const nonce = useDataSourceUi((s) => s.recentMenuNonceByTab[tabKey] ?? 0)
  // ⌘E：nonce 比处理过的新即开着（挂载之前按的算处理过）；点按钮开合另记
  const [handledNonce, setHandledNonce] = useState(nonce)
  const [clicked, setClicked] = useState(false)

  useEffect(() => {
    loadRecents(dataSourceId)
  }, [loadRecents, dataSourceId])

  const shown = recents.filter(
    (opened): opened is Extract<DataSourceOpened, { kind: K }> => opened.kind === kind
  )

  return (
    <RecentMenu
      title={shortcutTitle('最近打开', SHORTCUT.recentFiles)}
      emptyText={kind === 'object' ? '暂无最近打开的对象' : '暂无最近打开的键'}
      items={shown.map(itemOf)}
      currentKey={current === null ? null : openedKey(current)}
      open={clicked || nonce !== handledNonce}
      onOpenChange={(next) => {
        setClicked(next)
        if (!next) setHandledNonce(nonce)
      }}
      onPick={(key) => {
        const opened = shown.find((o) => openedKey(o) === key)
        if (opened !== undefined) onOpen(opened)
      }}
      onFocusContent={onFocusContent}
    />
  )
}
