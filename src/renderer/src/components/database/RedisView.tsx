// 连上后的 Redis Data Source Tab（docs/prd/database.md「Redis」）：布局同 SQL 数据库（DataSourceLayout）——右侧是键列表；
// 左侧「当前键」与「控制台」两格。顶栏右端有「最近打开」（这个数据源最近打开的键，连同所在的库，它的各个 Tab 共用；点一项
// 即打开——在别的库时先切到那个库，键列表也展开并滚到它），点开了键时可「在键列表中显示」。还没点开键时「当前键」一格
// 空着；切库（下拉切换、控制台里 SELECT）时清空。记住停在哪一格与上次打开的键（跨重启，连上后恢复；所在的库对不上时不
// 恢复）；恢复与点最近打开时先核对键还在，已不在即安静地空着，并从最近打开里去掉。点最近打开的一项打开后焦点进正文，
// ⌘E 弹出的被 Esc 关掉时焦点回正文（停在控制台时为它的编辑器）。
import { useEffect, useRef, useState } from 'react'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { useDataSourceUi } from '@renderer/data-source-store'
import {
  contextSwitchFailure,
  switchConsoleContext,
  useConsoleContext,
  type ContextSwitchFailure
} from '@renderer/lib/data-source-context'
import { useDataSourceOpened, type OpenedPresence } from '@renderer/lib/data-source-opened'
import { useDataSourceTabUi } from '@renderer/lib/data-source-tab-ui'
import type { DataSourceOpened, DataSourceTabUi } from '@shared/data-source-ui'
import { redisKeyName } from '@shared/redis'
import { DataSourceLayout } from './DataSourceLayout'
import { DataSourceRecentMenu } from './DataSourceRecentMenu'
import { RedisConsole } from './RedisConsole'
import { RedisKeyTree, type RedisKeyTreeHandle } from './RedisKeyTree'
import { RedisKeyView } from './RedisKeyView'

interface RedisViewProps {
  tabKey: string
  dataSourceId: string
  /** 键列表根行显示的数据源名 */
  name: string
  onDisconnect: () => void
}

type OpenedKey = Extract<DataSourceOpened, { kind: 'key' }>

/** 当前键：键名与所在的库（库编号不知道时为 null）。 */
interface CurrentKey {
  key: string
  database: number | null
}

/** 记下的键（最近打开、跨重启恢复）：库编号不知道时不写。 */
function openedOf({ key, database }: CurrentKey): OpenedKey {
  return database === null ? { kind: 'key', key } : { kind: 'key', key, database }
}

/** 键还在不在：在为 present，不在为 absent，问不出来（连不上）为 unknown。 */
async function checkKey(tabKey: string, key: string): Promise<OpenedPresence> {
  const result = await window.api.hasRedisKey(tabKey, key)
  if (typeof result !== 'boolean') return 'unknown'
  return result ? 'present' : 'absent'
}

export function RedisView(props: RedisViewProps): React.JSX.Element {
  const tabUi = useDataSourceTabUi(props.tabKey, true)
  // 记住的界面状态读到之前留白（本机读取，很快），读到了才按它建各格
  if (tabUi === null) return <div className="h-full" />
  return <RestoredRedisView {...props} saved={tabUi.saved} save={tabUi.save} />
}

function RestoredRedisView({
  tabKey,
  dataSourceId,
  name,
  onDisconnect,
  saved,
  save
}: RedisViewProps & {
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
    dismiss,
    focusContent,
    contentFocus
  } = useDataSourceOpened({ saved, save, dataSourceId, kind: 'key', openedOf })
  // 点最近打开时切不过去库：弹错误框（标题与原因），点「确定」清掉
  const [error, setError] = useState<ContextSwitchFailure | null>(null)
  const treeRef = useRef<RedisKeyTreeHandle>(null)
  const dropRecent = useDataSourceUi((s) => s.dropRecent)
  // 控制台上下文读一份，往下交给键列表
  const context = useConsoleContext(tabKey)
  // 键列表与控制台所在的库；还没得知、问不到为 null
  const database = context?.kind === 'redis' ? context.database : null

  // 切库时清空别的库的当前键：渲染期比对上一次的库（React「渲染中调整 state」模式，非 effect）。当前键已是新库的（点
  // 最近打开里别的库的键时，打开可能先于切库的推送到达）不清
  const [seenDatabase, setSeenDatabase] = useState(database)
  if (database !== seenDatabase) {
    setSeenDatabase(database)
    if (current !== null && current.database !== database) dismiss()
  }

  // 恢复上次打开的键：记下的库与连上后所在的库对不上时不恢复（安静地空着）；核对它还在才显示（不再记一遍），已不在即
  // 空着，并从最近打开里去掉
  useEffect(() => {
    const last = saved.opened
    if (last?.kind !== 'key') return
    const live = begin()
    void (async () => {
      const context = await window.api.getDataSourceConsoleContext(tabKey)
      const at = context?.kind === 'redis' ? context.database : null
      const elsewhere = last.database !== undefined && at !== null && last.database !== at
      const presence = elsewhere ? 'unknown' : await checkKey(tabKey, last.key)
      if (live()) restored(presence, { key: last.key, database: at }, last)
    })()
  }, [tabKey, saved, begin, restored])

  /**
   * 点最近打开的一项：记下的库不是所在的库时先切过去（控制台正在执行时不切、也不打开；切不过去弹错误框），再核对键还在、
   * 打开（焦点进正文），键列表也展开并滚到它（同 Files 的最近打开文件）；已不在即空着（从最近打开里去掉），问不出来也
   * 空着。库编号未知时记下的按所在的库打开，并换成带库编号的（先去掉它，免得同一个键出现两项）
   */
  const openRecent = async (opened: OpenedKey): Promise<void> => {
    const live = begin()
    const at = opened.database ?? database
    if (at !== null && at !== database) {
      const change = { kind: 'redis', database: at } as const
      const failure = await switchConsoleContext(tabKey, context, change)
      if (!live() || failure === 'busy') return
      if (failure !== null) {
        setError(contextSwitchFailure(context, change, failure))
        return
      }
    }
    const presence = await checkKey(tabKey, opened.key)
    if (!live()) return
    if (presence === 'present') {
      if (opened.database === undefined) dropRecent(dataSourceId, opened)
      open({ key: opened.key, database: at }, true)
      treeRef.current?.reveal(opened.key)
    } else {
      clear(presence, opened)
    }
  }

  return (
    <>
      <DataSourceLayout
        slot={slot}
        onSlotChange={changeSlot}
        currentLabel={current === null ? '当前键' : redisKeyName(current.key)}
        recent={
          <DataSourceRecentMenu
            tabKey={tabKey}
            dataSourceId={dataSourceId}
            kind="key"
            current={current === null ? null : openedOf(current)}
            onOpen={(opened) => void openRecent(opened)}
            onFocusContent={focusContent}
          />
        }
        reveal={
          current === null
            ? undefined
            : { title: '在键列表中显示', onClick: () => treeRef.current?.reveal(current.key) }
        }
        restoring={restoring}
        contentFocus={contentFocus}
        currentView={
          current === null ? null : (
            <RedisKeyView
              key={`${current.database}\0${current.key}`}
              tabKey={tabKey}
              redisKey={current.key}
            />
          )
        }
        consoleView={<RedisConsole tabKey={tabKey} />}
        tree={
          <RedisKeyTree
            ref={treeRef}
            tabKey={tabKey}
            context={context}
            name={name}
            selectedKey={current?.key ?? null}
            onOpenKey={(key) => open({ key, database })}
            onDisconnect={onDisconnect}
          />
        }
      />
      {error !== null && (
        <ErrorDialog title={error.title} message={error.message} onClose={() => setError(null)} />
      )}
    </>
  )
}
