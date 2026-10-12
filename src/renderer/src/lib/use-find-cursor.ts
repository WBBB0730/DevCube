import { useCallback, useRef, useState } from 'react'

/** 交给查找栏（FindBar）的计数与导航 */
export type FindCursorBar = {
  countLabel: string | null
  canNavigate: boolean
  onNavigate: (dir: 1 | -1) => void
}

/**
 * 预览查找（表格、PPT、Markdown）的当前命中。每轮查找（查找会话的 round）开始时记下此刻的起点、清掉上一个 / 下一个的
 * 选择，首个命中取起点及之后的第一个（「之后」怎么算归各视图）；上一个 / 下一个从当前命中起循环。只有本轮的首个命中或
 * 某次上一个 / 下一个才滚过去，其他重渲染（拖列宽、缩放、正文在外面被改）不再把视口拽回命中处。
 */
export function useFindCursor<T>(
  round: number,
  origin: T
): {
  /** 本轮起点：本轮开始（或视图挂上）时的 `origin` */
  start: T
  /** 上一个 / 下一个选中的命中；null = 取本轮起点起的首个。每按一次都是新对象：只有一个命中时再按也滚过去 */
  picked: { index: number } | null
  /** 换了查找范围（如换了工作表）：从 `start` 重新数；渲染期调 */
  restart: (start: T) => void
  /** 当前命中下标：选过且还在范围内取选中的，否则取 `first()`（本轮起点起的首个）；没有命中为 -1 */
  currentOf: (total: number, first: () => number) => number
  /** 首个命中为 `first`（以对象为记）时这次该不该滚过去：本轮首个命中或这次选择还没滚过就记下并返回 true；只在副作用里调 */
  claimReveal: (first: object | null) => boolean
  /** 查找栏的计数与导航 */
  barOf: (query: string, current: number, total: number) => FindCursorBar
} {
  const [cursor, setCursor] = useState(() => ({
    round,
    start: origin,
    picked: null as { index: number } | null
  }))
  // 新一轮查找：渲染期比对（React「渲染中调整 state」模式，非 effect）
  if (cursor.round !== round) setCursor({ round, start: origin, picked: null })
  const { start, picked } = cursor
  const revealedFor = useRef<object | null>(null)

  const currentOf = useCallback(
    (total: number, first: () => number) =>
      total === 0 ? -1 : picked !== null && picked.index < total ? picked.index : first(),
    [picked]
  )
  const claimReveal = useCallback(
    (first: object | null) => {
      const key = picked ?? first
      if (revealedFor.current === key) return false
      revealedFor.current = key
      return true
    },
    [picked]
  )

  return {
    start,
    picked,
    restart: (next) => setCursor((c) => ({ ...c, start: next, picked: null })),
    currentOf,
    claimReveal,
    barOf: (query, current, total) => ({
      countLabel: query === '' ? null : total === 0 ? '无结果' : `${current + 1}/${total}`,
      canNavigate: total > 0,
      onNavigate: (dir) =>
        setCursor((c) => ({ ...c, picked: { index: (current + dir + total) % total } }))
    })
  }
}
