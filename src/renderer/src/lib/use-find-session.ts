import { useCallback, useEffect, useState } from 'react'

/** 查找栏（FindBar）里与命中无关的部分：查询、选项及其回调 */
export interface FindSessionBar {
  query: string
  onQueryChange: (query: string) => void
  /** 有一次待办的聚焦（打开查找、已开时再按 Cmd+F）：查找栏聚焦输入框并全选后调 onFocusHandled 销掉 */
  focusPending: boolean
  onFocusHandled: () => void
  caseSensitive: boolean
  onToggleCaseSensitive: () => void
  wholeWord: boolean
  onToggleWholeWord: () => void
  regexp: boolean
  onToggleRegexp: () => void
}

/**
 * 一份查找（⌘F）会话：查找栏开没开、查询与区分大小写 / 全词 / 正则开关。查找跟着文件走：Files 按文件各记一份
 * （同一个文件的编辑与预览共用，切换不关、不清空；切走再切回来原样恢复，只在本次运行中记着）；没有文件的地方
 * （数据源）各用自己的一份。命中怎么找、怎么标、从哪找起归各视图的查找引擎。
 */
export interface FindSession {
  open: boolean
  /** 每开始新一轮查找（打开、已开时再按 Cmd+F、改查询或选项、换了文件）+1：从起点找的引擎据此重定起点 */
  round: number
  openFind: () => void
  closeFind: () => void
  /** 查询、选项及其回调：交给查找栏，引擎也从这里读 */
  bar: FindSessionBar
}

/** 一份查找会话里随文件记的状态（待办聚焦与轮次另计，不随文件记） */
export type FindSessionState = {
  open: boolean
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
}

/** 按文件记的查找会话（键为文件路径）：调用方持有，文件改名 / 删除时由调用方跟着改 */
export type FindMemory = Map<string, FindSessionState>

const INITIAL: FindSessionState = {
  open: false,
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false
}

/**
 * `scope` 为当前文件、`memory` 为按文件记的会话：换了文件即取出新文件记着的那份（没记过的从头来）；
 * 不给 memory 则只有一份。
 */
export function useFindSession(scope: string | null = null, memory?: FindMemory): FindSession {
  const restore = (key: string | null): FindSessionState =>
    (key === null ? undefined : memory?.get(key)) ?? INITIAL
  const [{ state, round, focusPending }, setSession] = useState(() => ({
    state: restore(scope),
    round: 0,
    focusPending: false
  }))

  // 换了文件：渲染期比对（React「渲染中调整 state」模式，非 effect），取出新文件记着的那份，恢复出来的查找栏不抢焦点；
  // 轮次接着数不归零，跨文件留着的视图（预览组件不随文件重挂）不会把新文件的一轮错认成上个文件的
  const [seenScope, setSeenScope] = useState(scope)
  if (scope !== seenScope) {
    setSeenScope(scope)
    setSession((s) => ({ state: restore(scope), round: s.round + 1, focusPending: false }))
  }

  // 随改随记（旧文件的那份在换文件前最后一次提交时已记下）；没动过查找的文件不留记录
  useEffect(() => {
    if (memory && scope !== null && state !== INITIAL) memory.set(scope, state)
  }, [memory, scope, state])

  const openFind = useCallback(
    () =>
      setSession((s) => ({
        state: { ...s.state, open: true },
        round: s.round + 1,
        focusPending: true
      })),
    []
  )
  const closeFind = useCallback(
    () => setSession((s) => (s.state.open ? { ...s, state: { ...s.state, open: false } } : s)),
    []
  )
  const onFocusHandled = useCallback(
    () => setSession((s) => (s.focusPending ? { ...s, focusPending: false } : s)),
    []
  )
  /** 改查询或选项：新一轮查找 */
  const change = (patch: (s: FindSessionState) => Partial<FindSessionState>): void =>
    setSession((s) => ({ ...s, state: { ...s.state, ...patch(s.state) }, round: s.round + 1 }))

  return {
    open: state.open,
    round,
    openFind,
    closeFind,
    bar: {
      query: state.query,
      onQueryChange: (query) => change(() => ({ query })),
      focusPending,
      onFocusHandled,
      caseSensitive: state.caseSensitive,
      onToggleCaseSensitive: () => change((s) => ({ caseSensitive: !s.caseSensitive })),
      wholeWord: state.wholeWord,
      onToggleWholeWord: () => change((s) => ({ wholeWord: !s.wholeWord })),
      regexp: state.regexp,
      onToggleRegexp: () => change((s) => ({ regexp: !s.regexp }))
    }
  }
}
