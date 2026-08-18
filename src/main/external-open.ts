import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** External Open（外部唤起）：deep link / 启动参数的解析与「就绪前排队」。术语见 CONTEXT.md。 */

export type ExternalOpenDeps = {
  /** 判定路径是否为存在的目录（解析层唯一的 IO，注入以便测试） */
  isDirectory: (path: string) => boolean
}

const defaultDeps: ExternalOpenDeps = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  }
}

/** deep link 仅认 `<scheme>://open?path=<绝对路径>`；其余形态一律 null。 */
export function parseDeepLink(url: string, scheme: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${scheme}:`) return null
  // `scheme://open` 的 open 落在 host；`scheme:open` 等无 `//` 形态落在 pathname。
  const action = parsed.host !== '' ? parsed.host : parsed.pathname.replace(/^\/+/, '')
  if (action !== 'open') return null
  const path = parsed.searchParams.get('path')
  if (path == null || path === '' || !isAbsolute(path)) return null
  return path
}

/**
 * 从启动参数提取要打开的目录：跳过 flag，deep link 参数走 parseDeepLink，
 * 其余按 cwd 解析相对路径后要求「存在且为目录」。argv 应已去掉可执行文件等前缀。
 */
export function extractOpenDirs(
  argv: readonly string[],
  opts: { scheme: string; cwd: string },
  deps: ExternalOpenDeps = defaultDeps
): string[] {
  const dirs: string[] = []
  for (const arg of argv) {
    if (arg === '' || arg.startsWith('-')) continue
    const fromLink = arg.includes('://') ? parseDeepLink(arg, opts.scheme) : null
    const candidate = fromLink ?? resolve(opts.cwd, arg)
    if (deps.isDirectory(candidate) && !dirs.includes(candidate)) dirs.push(candidate)
  }
  return dirs
}

/** 打包后 argv[0] 是应用本体；开发下是 electron + 入口目录。 */
export function argvTailStart(isPackaged: boolean): number {
  return isPackaged ? 1 : 2
}

// —— 就绪前排队：open-file / open-url 可能早于窗口与 store 就绪 ——

let openHandler: ((dir: string) => void) | null = null
const pending: string[] = []

/** 入口事件统一入队 / 转交（路径已校验为目录）。 */
export function dispatchExternalOpen(dir: string): void {
  if (openHandler) openHandler(dir)
  else pending.push(dir)
}

/** 冷启动初始化阶段取走排队目录（此后仍未设 handler 的新事件继续排队）。 */
export function drainPendingExternalOpens(): string[] {
  return pending.splice(0, pending.length)
}

/** 窗口就绪后挂上运行时 handler，先冲掉排队项。 */
export function setExternalOpenHandler(handler: (dir: string) => void): void {
  openHandler = handler
  for (const dir of drainPendingExternalOpens()) handler(dir)
}

export function isDirectoryPath(path: string): boolean {
  return defaultDeps.isDirectory(path)
}
