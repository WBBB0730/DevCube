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

/**
 * 从 since（毫秒时刻，如任务发起时）起过了 delay 毫秒才为真：挂载得晚（找回一个早已开始的任务）的
 * 不再从头等；已经过了的下一轮即为真。
 */
export function useShowSince(since: number, delay: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), Math.max(0, since + delay - Date.now()))
    return () => clearTimeout(timer)
  }, [since, delay])
  return shown
}
