// 连上后的 SQL 数据库的 Data Source Tab（docs/prd/database.md、ADR-0043；Redis 见 RedisView）：布局见 DataSourceLayout——
// 右侧目录；左侧「当前对象」（表与视图看数据，其余看定义或信息表）与「控制台」两格。顶栏右端：登记的数据源有「最近打开」
// （这个数据源最近打开的对象，它的各个 Tab 共用；点一项即打开，所在的库显示着时目录也展开并滚到它）；点开了对象时可
// 「在目录中显示」（所在的库没显示时先把它勾上）。PostgreSQL、MySQL / MariaDB 的目录与控制台的「库」只列显示的库。
// 还没点开对象时「当前对象」一格空着。登记的数据源的 Tab 记住停在哪一格、上次打开的对象与目录的展开（跨重启，连上后
// 恢复）；恢复上次的对象、点最近打开时先核对它还在（读它所在的那一层），已不在即安静地空着，并从最近打开里去掉。点最近
// 打开的一项打开后焦点进正文（表格或只读编辑器），⌘E 弹出的被 Esc 关掉时焦点回正文（停在控制台时为它的编辑器）；目录
// 右键「在控制台中打开」切到控制台，焦点进它的编辑器。Files 面板里直接打开的 SQLite 文件这些都不记。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCompletionUsage } from '@renderer/lib/data-source-completion-usage'
import {
  useConsoleCompletion,
  useConsoleContext,
  useTableCompletion
} from '@renderer/lib/data-source-context'
import { useDataSourceOpened, type OpenedPresence } from '@renderer/lib/data-source-opened'
import { useDataSourceTabUi } from '@renderer/lib/data-source-tab-ui'
import type { SqlKind } from '@shared/data-source'
import {
  catalogHasObject,
  catalogObjectKey,
  type CatalogObject,
  type CatalogPath
} from '@shared/data-source-catalog'
import { DATA_GROUPS } from '@shared/data-source-query'
import type { DataSourceOpened, DataSourceTabUi } from '@shared/data-source-ui'
import { CatalogTree, type CatalogTreeHandle, type ShownDatabases } from './CatalogTree'
import { ConsoleView } from './ConsoleView'
import { DataSourceLayout } from './DataSourceLayout'
import { DataSourceRecentMenu } from './DataSourceRecentMenu'
import { ObjectDetailView } from './ObjectDetailView'
import { TableDataView } from './TableDataView'

interface DataSourceViewProps {
  tabKey: string
  kind: SqlKind
  /** 目录根行显示的名字：数据源名，Files 面板里直接打开的 SQLite 文件为文件名 */
  name: string
  /**
   * 登记的数据源的 id：记住界面状态与控制台里写的内容、列最近打开；Files 面板里直接打开的 SQLite 文件为 null（都不记）
   */
  dataSourceId: string | null
  /** 显示的库（PostgreSQL、MySQL / MariaDB 才有）：目录根下与控制台的「库」只列它们，目录根行勾选 */
  shown?: ShownDatabases
  /** 不传则目录根行没有「断开连接」 */
  onDisconnect?: () => void
}

/**
 * 对象还在不在：读它所在的那一层（同目录现查），列着它为 present；那一层读到了却没有它为 absent；读不出来（连不上、
 * 无权）为 unknown。
 */
async function checkObject(tabKey: string, object: CatalogObject): Promise<OpenedPresence> {
  const layer = await window.api.readDataSourceCatalog(tabKey, object.path)
  if (!('nodes' in layer)) return 'unknown'
  return catalogHasObject(layer.nodes, object) ? 'present' : 'absent'
}

type OpenedObject = Extract<DataSourceOpened, { kind: 'object' }>

/** 记下的对象（最近打开、跨重启恢复）。 */
const objectOpened = (object: CatalogObject): OpenedObject => ({ kind: 'object', ...object })

export function DataSourceView(props: DataSourceViewProps): React.JSX.Element {
  const tabUi = useDataSourceTabUi(props.tabKey, props.dataSourceId !== null)
  // 记住的界面状态读到之前留白（本机读取，很快），读到了才按它建各格
  if (tabUi === null) return <div className="h-full" />
  return <RestoredDataSourceView {...props} saved={tabUi.saved} save={tabUi.save} />
}

function RestoredDataSourceView({
  tabKey,
  kind,
  name,
  dataSourceId,
  shown,
  onDisconnect,
  saved,
  save
}: DataSourceViewProps & {
  /** 连上时记住的界面状态（只在挂载时用） */
  saved: DataSourceTabUi
  save: (patch: Partial<DataSourceTabUi>) => void
}): React.JSX.Element {
  const {
    slot,
    changeSlot,
    current,
    restoring,
    begin,
    restored,
    open,
    clear,
    focusContent,
    contentFocus
  } = useDataSourceOpened({ saved, save, dataSourceId, kind: 'object', openedOf: objectOpened })
  // 目录重读时补全也重读
  const [schemaNonce, setSchemaNonce] = useState(0)
  // 补全用的表结构读一份，控制台与表数据的 WHERE / ORDER BY 框共用（重读了两处一起换）
  const consoleContext = useConsoleContext(tabKey)
  const completion = useConsoleCompletion(tabKey, consoleContext, schemaNonce)
  // PostgreSQL 打开的表不在控制台所在的库上时，两个框另读那个库的（在这里读：同一个库里换着打开表不重读）；打开的
  // 是别的对象（没有这两个框）时不读
  const tableCompletion = useTableCompletion(
    tabKey,
    consoleContext,
    current !== null && DATA_GROUPS.has(current.path.group!) ? current.path.database : undefined,
    completion,
    schemaNonce
  )
  // 补全的使用次数：这个数据源的各处补全共用
  const prioritizer = useCompletionUsage(dataSourceId)
  const catalogRef = useRef<CatalogTreeHandle>(null)

  // 恢复上次打开的对象：核对它还在才显示（不再记一遍）；已不在即空着，并从最近打开里去掉
  useEffect(() => {
    const last = saved.opened
    if (last?.kind !== 'object') return
    const live = begin()
    void checkObject(tabKey, last).then((presence) => {
      if (live()) restored(presence, last, last)
    })
  }, [tabKey, saved, begin, restored])

  const onExpandedChange = useCallback(
    (expanded: [string, CatalogPath][]) => save({ expanded }),
    [save]
  )

  /**
   * 点最近打开的一项：核对它还在再打开（焦点进正文），所在的库显示着时目录也展开并滚到它（同 Files 的最近打开文件；没显示
   * 的库不替用户勾上）；已不在即空着（从最近打开里去掉），读不出来也空着
   */
  const openRecent = (object: CatalogObject): void => {
    const live = begin()
    void checkObject(tabKey, object).then((presence) => {
      if (!live()) return
      if (presence === 'present') {
        open(object, true)
        catalogRef.current?.reveal(object, false)
      } else {
        clear(presence, objectOpened(object))
      }
    })
  }

  return (
    <DataSourceLayout
      slot={slot}
      onSlotChange={changeSlot}
      currentLabel={current?.name ?? '当前对象'}
      recent={
        dataSourceId === null ? undefined : (
          <DataSourceRecentMenu
            tabKey={tabKey}
            dataSourceId={dataSourceId}
            kind="object"
            current={current === null ? null : objectOpened(current)}
            onOpen={openRecent}
            onFocusContent={focusContent}
          />
        )
      }
      reveal={
        current === null
          ? undefined
          : {
              title: '在目录中显示',
              onClick: () => catalogRef.current?.reveal(current, true)
            }
      }
      restoring={restoring}
      contentFocus={contentFocus}
      currentView={
        current === null ? null : DATA_GROUPS.has(current.path.group!) ? (
          <TableDataView
            key={catalogObjectKey(current)}
            tabKey={tabKey}
            kind={kind}
            table={{
              database: current.path.database,
              schema: current.path.schema,
              name: current.name
            }}
            completion={tableCompletion}
            prioritizer={prioritizer}
          />
        ) : (
          <ObjectDetailView
            key={catalogObjectKey(current)}
            tabKey={tabKey}
            kind={kind}
            object={current}
          />
        )
      }
      consoleView={
        <ConsoleView
          tabKey={tabKey}
          kind={kind}
          context={consoleContext}
          shownDatabases={shown?.databases}
          persist={dataSourceId !== null}
          completion={completion}
          prioritizer={prioritizer}
          onSchemaChange={() => catalogRef.current?.refresh()}
        />
      }
      tree={
        <CatalogTree
          ref={catalogRef}
          tabKey={tabKey}
          context={consoleContext}
          name={name}
          shown={shown}
          onRefresh={() => setSchemaNonce((n) => n + 1)}
          selectedKey={current === null ? null : catalogObjectKey(current)}
          initialExpanded={saved.expanded}
          onExpandedChange={onExpandedChange}
          onOpenObject={open}
          onOpenConsole={() => changeSlot('console', true)}
          onDisconnect={onDisconnect}
        />
      }
    />
  )
}
