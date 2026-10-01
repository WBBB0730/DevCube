// 三棵树共用（Files 的文件树、数据源的目录与 Redis 键列表）：行的虚拟滚动，与定位——要显示的行出现（所在的层读到、
// 文件夹展开、重新列出）即滚入视口；行已在树里时也再滚一次。树不可见时定位先挂着，可见了再滚。
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'

/** 一次定位：每次一个新对象，同一行再定位也认得出是新的一次 */
interface RevealTarget {
  key: string
}

export function useTreeVirtualReveal<R>({
  rows,
  count = rows.length,
  rowHeight,
  rowKey,
  getItemKey,
  enabled = true,
  follow = null
}: {
  rows: readonly R[]
  /** 虚拟行数：rows 之后可以再跟几行（如列表末尾的提示行），缺省即 rows 的行数 */
  count?: number
  rowHeight: number
  /** 行在定位里认的键（不能被定位的行为 undefined）；应为模块级函数 */
  rowKey: (row: R) => string | undefined
  /** 虚拟行的 React key（缺省为下标） */
  getItemKey?: (index: number) => string | number
  /** 树可见：不可见时（面板切走、树隐藏）挂起的定位留着不滚，可见了再滚；缺省即可见 */
  enabled?: boolean
  /** 跟随的键（如 Files 的选中项）：一变即定位到它，变为 null 即撤掉挂起的定位；缺省不跟随 */
  follow?: string | null
}): {
  scrollRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  /** 滚到键为 key 的行：展开由调用方先做，这里等行出现即滚到 */
  scrollToRow: (key: string) => void
} {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 要滚到的行：null = 没有 */
  const [target, setTarget] = useState<RevealTarget | null>(null)
  /** 已滚到的那次定位：之后行再变也不重滚 */
  const doneRef = useRef<RevealTarget | null>(null)

  // 跟随的键一变即定位：渲染期比对上一次的键（React「渲染中调整 state」模式，非 effect）
  const [seenFollow, setSeenFollow] = useState(follow)
  if (follow !== seenFollow) {
    setSeenFollow(follow)
    setTarget(follow === null ? null : { key: follow })
  }

  // eslint-disable-next-line react-hooks/incompatible-library -- tanstack virtual 实例天然可变，React Compiler 跳过本 hook 的 memo 是预期行为
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    ...(getItemKey === undefined ? {} : { getItemKey })
  })

  useLayoutEffect(() => {
    if (!enabled || target === null || target === doneRef.current) return
    const index = rows.findIndex((row) => rowKey(row) === target.key)
    if (index < 0) return
    virtualizer.scrollToIndex(index)
    doneRef.current = target
  }, [enabled, target, rows, rowKey, virtualizer])

  // 身份稳定：调用方会把它放进 useCallback 的依赖
  const scrollToRow = useCallback((key: string): void => setTarget({ key }), [])

  return { scrollRef, virtualizer, scrollToRow }
}
