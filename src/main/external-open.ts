// 用户的文件用不带 asar 改装的原版 fs：Electron 改装过的 fs 会把 .asar 文件当成文件夹往里读（ADR-0051）
import { readFileSync, rmSync, statSync } from 'original-fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

/**
 * External Open（外部唤起）：deep link / 启动参数的解析与「就绪前排队」。术语见 CONTEXT.md。
 * 打开：目录 → 项目语义（登记或聚焦）；文件 → Preview Window（docs/prd/file-preview-window.md）。
 * 压缩：一组路径 → 压缩窗口（docs/prd/compress.md）。
 */

export type ExternalOpenKind = 'dir' | 'file'

export type ExternalOpenTarget =
  { kind: ExternalOpenKind; path: string } | { kind: 'compress'; paths: string[] }

export type ExternalOpenDeps = {
  /** 判定路径是目录 / 文件 / 都不是（解析层的 IO，注入以便测试） */
  classify: (path: string) => ExternalOpenKind | null
  /** 读出并删掉压缩清单文件（一行一个路径）；不是我们写的清单文件则返回空 */
  takeCompressList: (file: string) => string[]
}

/** 压缩请求的启动参数：Windows 右键扩展以 `--compress <路径…>` 启动（ADR-0049）。 */
export const COMPRESS_ARG = '--compress'
/** 路径太多、命令行装不下时，右键扩展改把清单写进临时目录，以 `--compress-list=<文件>` 传入。 */
export const COMPRESS_LIST_ARG = '--compress-list='
const COMPRESS_LIST_FILE = /^devcube-compress-[\w-]+\.txt$/

/** 只认临时目录里按约定命名的清单文件：解析参数会删掉它，不能让任意参数指向别的文件。 */
export function isCompressListFile(file: string, tempDir: string): boolean {
  const sameDir =
    process.platform === 'win32'
      ? dirname(file).toLowerCase() === resolve(tempDir).toLowerCase()
      : dirname(file) === resolve(tempDir)
  return isAbsolute(file) && sameDir && COMPRESS_LIST_FILE.test(basename(file))
}

const defaultDeps: ExternalOpenDeps = {
  classify: (path) => {
    try {
      const st = statSync(path)
      if (st.isDirectory()) return 'dir'
      if (st.isFile()) return 'file'
      return null
    } catch {
      return null
    }
  },
  takeCompressList: (file) => {
    if (!isCompressListFile(file, tmpdir())) return []
    try {
      return readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line !== '')
    } catch {
      return []
    } finally {
      rmSync(file, { force: true })
    }
  }
}

export type DeepLink = { action: 'open'; path: string } | { action: 'compress'; paths: string[] }

/**
 * deep link 认两种：`<scheme>://open?path=<绝对路径>` 与 `<scheme>://compress?path=<绝对路径>&path=…`；
 * 其余形态一律 null。
 */
export function parseDeepLink(url: string, scheme: string): DeepLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${scheme}:`) return null
  // `scheme://open` 的 open 落在 host；`scheme:open` 等无 `//` 形态落在 pathname。
  const action = parsed.host !== '' ? parsed.host : parsed.pathname.replace(/^\/+/, '')
  const usable = (path: string): boolean => path !== '' && isAbsolute(path)
  if (action === 'open') {
    const path = parsed.searchParams.get('path')
    return path !== null && usable(path) ? { action: 'open', path } : null
  }
  if (action === 'compress') {
    const paths = parsed.searchParams.getAll('path').filter(usable)
    return paths.length > 0 ? { action: 'compress', paths } : null
  }
  return null
}

/** deep link → 目标：路径须存在；压缩只留存在的路径，全都不在则 null。 */
export function targetFromDeepLink(
  link: DeepLink,
  deps: ExternalOpenDeps = defaultDeps
): ExternalOpenTarget | null {
  if (link.action === 'open') {
    const kind = deps.classify(link.path)
    return kind === null ? null : { kind, path: link.path }
  }
  const paths = [...new Set(link.paths)].filter((p) => deps.classify(p) !== null)
  return paths.length > 0 ? { kind: 'compress', paths } : null
}

/**
 * 从启动参数提取目标：跳过 flag，deep link 参数走 parseDeepLink，其余按 cwd 解析相对路径后要求
 * 「存在且为目录或文件」。带 `--compress` 时其余路径参数都是压缩请求的路径（合成一个压缩目标），
 * 不按打开处理。argv 应已去掉可执行文件等前缀。
 */
export function extractOpenTargets(
  argv: readonly string[],
  opts: { scheme: string; cwd: string },
  deps: ExternalOpenDeps = defaultDeps
): ExternalOpenTarget[] {
  const compressing = argv.includes(COMPRESS_ARG)
  const targets: ExternalOpenTarget[] = []
  const compressPaths: string[] = []
  const exists = (path: string): boolean => deps.classify(path) !== null
  const pushOpen = (target: ExternalOpenTarget): void => {
    if (target.kind === 'compress') targets.push(target)
    else if (!targets.some((t) => t.kind !== 'compress' && t.path === target.path)) {
      targets.push(target)
    }
  }
  for (const arg of argv) {
    if (arg.startsWith(COMPRESS_LIST_ARG)) {
      const listed = deps.takeCompressList(arg.slice(COMPRESS_LIST_ARG.length))
      compressPaths.push(...listed.map((p) => resolve(opts.cwd, p)).filter(exists))
      continue
    }
    if (arg === '' || arg.startsWith('-')) continue
    if (arg.includes('://')) {
      const link = parseDeepLink(arg, opts.scheme)
      const target = link === null ? null : targetFromDeepLink(link, deps)
      if (target) pushOpen(target)
      continue
    }
    const candidate = resolve(opts.cwd, arg)
    if (compressing) {
      if (exists(candidate)) compressPaths.push(candidate)
      continue
    }
    const kind = deps.classify(candidate)
    if (kind !== null) pushOpen({ kind, path: candidate })
  }
  if (compressPaths.length > 0)
    targets.push({ kind: 'compress', paths: [...new Set(compressPaths)] })
  return targets
}

/** 打包后 argv[0] 是应用本体；开发下是 electron + 入口目录。 */
export function argvTailStart(isPackaged: boolean): number {
  return isPackaged ? 1 : 2
}

// —— 就绪前排队：open-file / open-url 可能早于窗口与 store 就绪 ——

let openHandler: ((target: ExternalOpenTarget) => void) | null = null
const pending: ExternalOpenTarget[] = []

/** 入口事件统一入队 / 转交（路径已校验存在）。 */
export function dispatchExternalOpen(target: ExternalOpenTarget): void {
  if (openHandler) openHandler(target)
  else pending.push(target)
}

/** 冷启动初始化阶段取走排队目标（此后仍未设 handler 的新事件继续排队）。 */
export function drainPendingExternalOpens(): ExternalOpenTarget[] {
  return pending.splice(0, pending.length)
}

/** 窗口就绪后挂上运行时 handler，先冲掉排队项。 */
export function setExternalOpenHandler(handler: (target: ExternalOpenTarget) => void): void {
  openHandler = handler
  for (const target of drainPendingExternalOpens()) handler(target)
}

/** 校验单个路径（open-file 事件）：目录或文件才产出目标。 */
export function classifyExternalPath(path: string): ExternalOpenTarget | null {
  const kind = defaultDeps.classify(path)
  return kind === null ? null : { kind, path }
}
