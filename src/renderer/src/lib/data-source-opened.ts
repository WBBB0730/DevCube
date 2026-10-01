// Data Source Tab 左侧「当前对象 / 当前键」一格的状态（docs/prd/database.md「记住上次打开的」「最近打开」；SQL 数据库的
// DataSourceView 与 Redis 的 RedisView 共用）：停在哪一格、当前打开的是什么、是否还在核对上次打开的。打开即切到这一格并
// 记下它（跨重启恢复、最近打开）。要先核对还在不在的打开（恢复上次的、点最近打开）由调用方核对：开始时取一个判断结果
// 是否还要用的函数，之后又打开了别的，那次的结果就不用了。
// 点最近打开的一项打开后焦点进正文（同 Files 的最近打开文件），目录右键「在控制台中打开」切到控制台后焦点同样进它的
// 编辑器：当前显示那一格里的正文挂载时登记（见 data-source-content-focus），打开时还没读到就等它登记；其间切到另一格即
// 作废。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataSourceUi } from '@renderer/data-source-store'
import type { ContentFocusRegister } from '@renderer/lib/data-source-content-focus'
import type { DataSourceOpened, DataSourceSlot, DataSourceTabUi } from '@shared/data-source-ui'

/** 打开过的还在不在：还在为 present，确知已不在为 absent，问不出来（连不上、无权）为 unknown。 */
export type OpenedPresence = 'present' | 'absent' | 'unknown'

export interface DataSourceOpenedState<T> {
  slot: DataSourceSlot
  /** 切到另一格（记下停在哪一格）；focus 为切过去后焦点进正文（目录右键「在控制台中打开」） */
  changeSlot: (slot: DataSourceSlot, focus?: boolean) => void
  /** 当前打开的；还没打开、已不在时为 null */
  current: T | null
  /** 正在核对上次打开的还在不在（恢复时）：「当前」格显示加载中 */
  restoring: boolean
  /** 开始一次要先核对的打开（恢复上次的、点最近打开）：交回判断结果是否还要用的函数（之后又打开了别的即不用） */
  begin: () => () => boolean
  /** 上次打开的核对完了：还在即显示 value（不再记一遍）；已不在即从最近打开里去掉 opened（记下的那一项） */
  restored: (presence: OpenedPresence, value: T, opened: DataSourceOpened) => void
  /** 打开：切到「当前」格，记下它（跨重启恢复、最近打开）；focus 为打开后焦点进正文（点最近打开时） */
  open: (value: T, focus?: boolean) => void
  /** 要打开的核对下来不在或问不出来：空着停在「当前」格，不再记它；已不在即从最近打开里去掉 opened */
  clear: (presence: Exclude<OpenedPresence, 'present'>, opened: DataSourceOpened) => void
  /** 只清掉当前打开的，记下的不动（Redis 切库时：当前键属于原来的库） */
  dismiss: () => void
  /** 焦点回当前显示那一格的正文（⌘E 弹出的「最近打开」被 Esc 关掉时）；正文还没挂上即不动 */
  focusContent: () => void
  /** 当前显示那一格里的正文登记聚焦自己的地方（交给 DataSourceLayout） */
  contentFocus: ContentFocusRegister
}

export function useDataSourceOpened<T>({
  saved,
  save,
  dataSourceId,
  kind,
  openedOf
}: {
  /** 连上时记住的界面状态（只在挂载时用） */
  saved: DataSourceTabUi
  save: (patch: Partial<DataSourceTabUi>) => void
  /** 登记的数据源的 id（列最近打开）；Files 面板里直接打开的 SQLite 文件为 null（不记） */
  dataSourceId: string | null
  /** 打开的是哪一类（SQL 数据库为对象，Redis 为键）：记住的是这一类才恢复 */
  kind: DataSourceOpened['kind']
  /** 打开的记下来的样子（跨重启恢复、最近打开） */
  openedOf: (value: T) => DataSourceOpened
}): DataSourceOpenedState<T> {
  const [slot, setSlot] = useState<DataSourceSlot>(saved.slot)
  const [current, setCurrent] = useState<T | null>(null)
  const [restoring, setRestoring] = useState(saved.opened?.kind === kind)
  /** 每开始一次打开 +1：核对期间又打开了别的，那次核对的结果就不用了 */
  const openSeq = useRef(0)
  const pushRecent = useDataSourceUi((s) => s.pushRecent)
  const dropRecent = useDataSourceUi((s) => s.dropRecent)
  /** 正文登记着的聚焦函数 */
  const contentFocusRef = useRef<(() => void) | null>(null)
  /** 打开或切格后要聚焦正文、还没聚焦上（正文还在读取）：它登记时再聚焦 */
  const focusPending = useRef(false)
  /** 每次要聚焦 +1：提交之后再试（本就停在这一格、打开的又是原来那个时正文不重挂，不会再登记） */
  const [focusNonce, setFocusNonce] = useState(0)

  const contentFocus = useCallback<ContentFocusRegister>((focus) => {
    contentFocusRef.current = focus
    if (focusPending.current) {
      focusPending.current = false
      focus()
    }
    return () => {
      if (contentFocusRef.current === focus) contentFocusRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!focusPending.current || contentFocusRef.current === null) return
    focusPending.current = false
    contentFocusRef.current()
  }, [focusNonce])

  const begin = useCallback((): (() => boolean) => {
    const seq = ++openSeq.current
    return () => seq === openSeq.current
  }, [])

  const restored = useCallback(
    (presence: OpenedPresence, value: T, opened: DataSourceOpened): void => {
      setRestoring(false)
      if (presence === 'present') setCurrent(value)
      else if (presence === 'absent' && dataSourceId !== null) dropRecent(dataSourceId, opened)
    },
    [dataSourceId, dropRecent]
  )

  const changeSlot = (next: DataSourceSlot, focus = false): void => {
    if (next !== slot) {
      setSlot(next)
      save({ slot: next })
      focusPending.current = false
    }
    if (focus) {
      focusPending.current = true
      setFocusNonce((n) => n + 1)
    }
  }

  const open = (value: T, focus = false): void => {
    openSeq.current += 1
    setCurrent(value)
    setRestoring(false)
    setSlot('current')
    const opened = openedOf(value)
    save({ slot: 'current', opened })
    if (dataSourceId !== null) pushRecent(dataSourceId, opened)
    focusPending.current = focus
    if (focus) setFocusNonce((n) => n + 1)
  }

  const clear = (presence: Exclude<OpenedPresence, 'present'>, opened: DataSourceOpened): void => {
    setCurrent(null)
    setRestoring(false)
    setSlot('current')
    save({ slot: 'current', opened: null })
    focusPending.current = false
    if (presence === 'absent' && dataSourceId !== null) dropRecent(dataSourceId, opened)
  }

  return {
    slot,
    changeSlot,
    current,
    restoring,
    begin,
    restored,
    open,
    clear,
    dismiss: () => setCurrent(null),
    focusContent: () => contentFocusRef.current?.(),
    contentFocus
  }
}
