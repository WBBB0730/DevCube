// Git Tab 的共享时钟（整秒）：图谱「日期」列的相对时间与提交详情里运行中检查的已运行时长读同一个「现在」，
// 每秒走一格。常驻不停——React 先渲染后订阅，按订阅启停会让首帧拿到停摆时的旧时刻、下一帧才纠正（闪一下）。
// 读法：useSyncExternalStore(subscribeClock, () => 由 clockNowSec() 算出的文案)，文案变了才重渲染。

let nowSec = Math.floor(Date.now() / 1000)
const listeners = new Set<() => void>()
setInterval(() => {
  nowSec = Math.floor(Date.now() / 1000)
  listeners.forEach((notify) => notify())
}, 1000)

export function subscribeClock(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

/** 共享时钟当前的「现在」（Unix 秒）。 */
export function clockNowSec(): number {
  return nowSec
}
