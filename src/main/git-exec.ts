// git 可执行文件的发现与进程执行包装 —— 数据读取层与动作层唯一的 git 进程入口。
// macOS GUI 应用（Dock/Finder 启动）拿到的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin，
// Homebrew 的 git 找不到，所以先用用户登录 shell 解析一次 git 路径，失败再回退固定候选。

import * as cp from 'child_process'
import { promises as fs } from 'fs'
import { join, normalize } from 'path'

/** 行分割：兼容 \r\n / \r / \n（与 git-parse 中的常量同义，为避免层间依赖各自持有）。 */
const EOL_REGEX = /\r\n|\r|\n/g

/** 已通过 --version 验证可用的 git 可执行文件。 */
export interface GitExecutable {
  path: string
  /** `git --version` 输出去掉前缀 "git version " 并 trim */
  version: string
}

/** 一次 git 进程执行的完整产物；永不 throw，失败信息在 code / stderr / error 里。 */
export interface GitExecResult {
  /** 退出码；spawn 层失败（如 ENOENT）时为 -1 */
  code: number
  /** 原始字节 —— 读文件内容需要按编码转换，其余场景调用方自行 toString('utf8') */
  stdout: Buffer
  stderr: string
  /** spawn 层错误（可执行文件不存在等）；进程正常退出时为 null */
  error: Error | null
}

/** spawn 一个进程并收集输出；永不 reject（结束以 close 事件为准，此时 stdio 已收集完）。 */
function run(file: string, args: string[], cwd?: string): Promise<GitExecResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let error: Error | null = null
    let settled = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks),
        // 先 concat 再 toString，避免多字节字符被 chunk 边界拆断
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        error
      })
    }
    let child: cp.ChildProcess
    try {
      child = cp.spawn(file, args, {
        cwd,
        // GIT_TERMINAL_PROMPT=0：防止任何命令意外等待终端输入（读取类命令全部离线）
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
    } catch (e) {
      // spawn 同步抛错（参数非法等）也不外抛，统一走结果对象
      error = e as Error
      finish(-1)
      return
    }
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (e) => {
      error = e
      // spawn 失败（pid 拿不到）时 close 事件在部分场景不可靠，这里直接收口；settled 卫兵防双收
      if (child.pid === undefined) finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
  })
}

// —— git 发现（模块级缓存） ——

// undefined = 尚未发现过；null = 已发现但确实找不到 git
let cachedGit: GitExecutable | null | undefined
let discovering: Promise<GitExecutable | null> | null = null

/** 验证候选路径确实是 git：跑 --version 并取出版本号。 */
async function verifyGit(path: string): Promise<GitExecutable | null> {
  const result = await run(path, ['--version'])
  if (result.code !== 0) return null
  const stdout = result.stdout.toString('utf8').trim()
  if (!stdout.startsWith('git version')) return null
  return { path, version: stdout.replace(/^git version /, '').trim() }
}

/** 真正的发现流程：登录 shell 解析 → 平台固定候选 → PATH 里的 git。 */
async function discoverGit(): Promise<GitExecutable | null> {
  // 1. 登录 shell 解析（加载用户的 PATH / nvm / Homebrew 等，像用户终端一样）
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL ?? '/bin/zsh'
    const result = await run(shell, ['-ilc', 'command -v git'])
    if (result.code === 0) {
      const path = result.stdout.toString('utf8').split(EOL_REGEX)[0].trim()
      if (path !== '') {
        const git = await verifyGit(path)
        if (git) return git
      }
    }
  }
  // 2. 固定候选回退
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/git', '/usr/local/bin/git')
    // /usr/bin/git 需要 Command Line Tools 已装，否则 --version 会触发系统安装弹窗
    const clt = await run('xcode-select', ['-p'])
    if (clt.code === 0) candidates.push('/usr/bin/git')
  } else if (process.platform === 'win32') {
    const bases = [
      process.env['ProgramW6432'],
      process.env['ProgramFiles(x86)'],
      process.env['ProgramFiles'],
      process.env['LocalAppData'] ? join(process.env['LocalAppData'], 'Programs') : undefined
    ]
    for (const base of bases) {
      if (base) candidates.push(join(base, 'Git', 'cmd', 'git.exe'))
    }
  }
  candidates.push('git') // 最后再试进程自身 PATH 里的 git
  for (const candidate of candidates) {
    const git = await verifyGit(candidate)
    if (git) return git
  }
  return null
}

/** 发现并缓存 git 可执行文件；找不到返回 null。并发调用共享同一次发现。 */
export async function findGit(): Promise<GitExecutable | null> {
  if (cachedGit !== undefined) return cachedGit
  if (!discovering) {
    discovering = discoverGit().then((git) => {
      cachedGit = git
      discovering = null
      return git
    })
  }
  return discovering
}

/** 执行一条 git 命令；永不 throw。ENOENT（git 被卸载/移动）时重新发现一次并重试。 */
export async function execGit(cwd: string, args: string[]): Promise<GitExecResult> {
  const git = await findGit()
  if (!git) {
    return {
      code: -1,
      stdout: Buffer.alloc(0),
      stderr: '',
      error: new Error('未找到 git，请安装或将其加入 PATH')
    }
  }
  const result = await run(git.path, args, cwd)
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    // 缓存的 git 路径已失效：清缓存重新发现，成功则重试一次
    cachedGit = undefined
    const rediscovered = await findGit()
    if (rediscovered) return run(rediscovered.path, args, cwd)
  }
  return result
}

/** 从执行结果提炼展示给用户的错误消息：stderr 在前、stdout 在后拼接，无条件丢掉最后一段
 * （与原实现一致——换行结尾时丢的是空串，得到干净消息）。 */
export function getErrorMessage(result: GitExecResult): string {
  const stdout = result.stdout.toString('utf8')
  if (stdout !== '' || result.stderr !== '') {
    const lines = (result.stderr + stdout).split(EOL_REGEX)
    lines.pop()
    return lines.join('\n')
  }
  if (result.error) return result.error.message.split(EOL_REGEX).join('\n')
  return ''
}

// —— 版本比较 ——

/** 提取 major.minor.patch；缺省补 0。解析不出返回 null。 */
function parseVersion(text: string): { major: number; minor: number; patch: number } | null {
  const match = text.match(/^[0-9]+(\.[0-9]+|)(\.[0-9]+|)/)
  if (!match) return null
  const parts = match[0].split('.')
  return {
    major: parseInt(parts[0], 10),
    minor: parts.length > 1 ? parseInt(parts[1], 10) : 0,
    patch: parts.length > 2 ? parseInt(parts[2], 10) : 0
  }
}

/** 比较 git 版本号（major.minor.patch 逐级）；解析不出时一律视为满足要求（与参考实现一致）。 */
export function isVersionAtLeast(version: string, required: string): boolean {
  const current = parseVersion(version)
  const target = parseVersion(required)
  if (!current || !target) return true
  if (current.major !== target.major) return current.major > target.major
  if (current.minor !== target.minor) return current.minor > target.minor
  return current.patch >= target.patch
}

// —— 仓库根解析（带缓存） ——

// 目录 → 仓库根 的缓存（null = 不在仓库内）；项目移除或需要重验时用 clearRepoRootCache 清理
const repoRootCache = new Map<string, string | null>()

/** 路径统一为 '/' 分隔。 */
function normalizeSep(path: string): string {
  return path.replace(/\\/g, '/')
}

/** realpath 失败（路径不存在等）时视为无别名，原样返回。 */
async function realpathOr(path: string): Promise<string> {
  try {
    return normalizeSep(await fs.realpath(path))
  } catch {
    /* 路径不存在等：视为无符号链接别名 */
    return path
  }
}

/** 无缓存的仓库根查找：rev-parse --show-toplevel + 符号链接回溯（保持用户视角路径）。 */
async function lookupRepoRoot(dir: string): Promise<string | null> {
  const result = await execGit(dir, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) return null
  const canonical = normalizeSep(normalize(result.stdout.toString('utf8').trim()))
  // git 返回 canonical 路径；用户路径含符号链接时，逐级向上找与之等价的用户视角路径，
  // 保证 UI 显示与用户登记的项目路径一致；回溯不命中则直接用 git 的结果
  let path = normalizeSep(dir)
  const first = path.indexOf('/')
  for (;;) {
    if (path === canonical || (await realpathOr(path)) === canonical) return path
    const next = path.lastIndexOf('/')
    if (next > -1 && next !== first) path = path.substring(0, next)
    else return canonical
  }
}

/** 解析目录所在仓库的根目录；不在仓库内（含裸仓库）返回 null。结果带模块级缓存。 */
export async function resolveRepoRoot(dir: string): Promise<string | null> {
  const cached = repoRootCache.get(dir)
  if (cached !== undefined) return cached
  const root = await lookupRepoRoot(dir)
  repoRootCache.set(dir, root)
  return root
}

/** 清空仓库根缓存：给 dir 只清该目录（项目移除时用），不给则全清。 */
export function clearRepoRootCache(dir?: string): void {
  if (dir === undefined) repoRootCache.clear()
  else repoRootCache.delete(dir)
}
