/** 应用正在执行退出清理：禁止再创建 chokidar/fsevents，避免退出竞态 abort。 */
let quitting = false
/** 用户已确认（或无需确认）允许退出整个应用。 */
let quitAllowed = false

export function isAppQuitting(): boolean {
  return quitting
}

export function markAppQuitting(): void {
  quitting = true
}

export function markQuitAllowed(): void {
  quitAllowed = true
}

export function isQuitAllowed(): boolean {
  return quitAllowed
}
