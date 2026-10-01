import { useEffect, useState } from 'react'

/**
 * 挂载后过了 delay 毫秒才为真：加载提示延迟出现，快的时候不闪（按「进入加载中才挂载」来用）。
 * delay ≤ 0 即刻为真。
 */
export function useShowAfter(delay: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (delay <= 0) return
    const timer = setTimeout(() => setElapsed(true), delay)
    return () => clearTimeout(timer)
  }, [delay])
  return delay <= 0 || elapsed
}
