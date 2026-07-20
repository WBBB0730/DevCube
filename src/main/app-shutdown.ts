/** 应用正在执行退出清理：禁止再创建 chokidar/fsevents，避免退出竞态 abort。 */
let quitting = false

export function isAppQuitting(): boolean {
  return quitting
}

export function markAppQuitting(): void {
  quitting = true
}
