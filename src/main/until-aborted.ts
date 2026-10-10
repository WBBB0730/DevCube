/** 等 promise 的结果，中途 signal 中止则立即以中止收口（进行中的事照常完成，结果不再理会）。 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    promise.then(resolve, reject)
  })
}
