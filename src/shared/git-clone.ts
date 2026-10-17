/**
 * 「从 Git 仓库克隆」的纯函数层：地址 → 目录名派生、地址形状判定、目录名校验、报错提炼与参数拼装。
 * 进度解析与其余联网 Git 动作共用（git-task）。
 * 纯解析（不访问磁盘、不依赖 node / electron），main / renderer 均可导入。
 */

import { stripGitProgress } from './git-task'

/** 克隆输入：渲染端表单填好后原样交给主进程。 */
export interface GitCloneInput {
  /** 仓库地址（https / ssh / scp 形式 / file / 本地路径，原样交给 git） */
  url: string
  /** 存放位置：目标目录的父目录（绝对路径） */
  parentDir: string
  /** 目标目录名（单层） */
  name: string
  /** 连带克隆子模块（--recurse-submodules） */
  recurseSubmodules: boolean
}

/** 目标目录状态：不存在 / 已存在且为空 / 被占用（非空目录或同名文件）。 */
export type GitCloneTargetState = 'free' | 'empty' | 'occupied'

/**
 * 网页 URL 里「仓库路径到此为止」的路由段：其后是分支 / 文件 / PR 等页面，不属于仓库地址。
 * GitLab 的 `-` 分隔符也在内，故子组路径（group/sub/repo）不会被误截。
 */
const WEB_ROUTE_SEGMENT =
  /^(?:-|tree|blob|commit|commits|compare|pull|pulls|merge_requests|issues|releases|tags|branches|wiki|actions|settings|src|raw)$/

/**
 * 把浏览器里复制来的仓库网页地址归一成可克隆的地址：剥查询串与锚点，并在遇到网页路由段
 * （`/tree/main`、`/blob/…`、`/pull/52` 等）时截断到仓库本身。
 * 只管 http(s)——ssh / scp / 本地路径不存在这种形态，原样返回。
 */
export function normalizeRepoUrl(url: string): string {
  const s = url.trim()
  if (!/^https?:\/\//i.test(s)) return s
  const bare = s.split('#')[0].split('?')[0].replace(/\/+$/, '')
  const scheme = bare.slice(0, bare.indexOf('://') + 3)
  const segments = bare.slice(scheme.length).split('/')
  // 从 owner/repo 之后（主机 + 两段）才开始认路由段，免得把仓库名本身当成路由
  const cut = segments.findIndex((seg, i) => i >= 3 && WEB_ROUTE_SEGMENT.test(seg))
  return cut < 0 ? bare : scheme + segments.slice(0, cut).join('/')
}

/**
 * 从仓库地址派生目录名，口径对齐 git 自身的 guess_dir_name（行为已逐条实测）：
 * 跳过 scheme 与认证信息 → 剥尾部空白/分隔符与 `<repo>/.git` → 只有主机名时剥端口 →
 * 取最后一段（`/`、`\`、`:` 均视作分隔）→ 剥 `.git` 后缀。
 * `.bundle` 不剥（git 只在明确的 bundle 场景剥）。派生不出（空地址等）返回空串。
 */
export function repoDirNameFromUrl(url: string): string {
  let s = normalizeRepoUrl(url)
  const scheme = s.indexOf('://')
  if (scheme >= 0) s = s.slice(scheme + 3)
  // 认证信息只在首个目录分隔符之前找（贪婪取最后一个 @，与 git 一致）
  const firstSep = s.search(/[/\\]/)
  const at = (firstSep < 0 ? s : s.slice(0, firstSep)).lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  s = s.replace(/[\s/\\]+$/, '')
  s = s.replace(/[/\\]\.git$/, '').replace(/[\s/\\]+$/, '') // `<repo>/.git` 形式
  // 无目录分隔符时尾部的 `:数字` 是端口而非路径（scp 形式的 `host:repo` 不受影响）
  if (!/[/\\]/.test(s)) s = s.replace(/:\d+$/, '')
  const lastSep = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'), s.lastIndexOf(':'))
  return s.slice(lastSep + 1).replace(/\.git$/, '')
}

/** 目标路径 = 存放位置 + 目录名；分隔符跟随存放位置（Windows 路径用 `\`）。 */
export function resolveClonePath(parentDir: string, name: string): string {
  const base = parentDir.trim().replace(/[/\\]+$/, '')
  return base + (parentDir.includes('\\') ? '\\' : '/') + name.trim()
}

/**
 * 从克隆的 stderr 里提炼报错：剔掉进度帧与 `Cloning into '…'` 这类例行提示，
 * 剩下的才是 git 真正想说的（认证失败、仓库不存在、网络错误等）。
 */
export function cloneErrorFromStderr(stderr: string): string {
  return stripGitProgress(stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Cloning into '))
    .join('\n')
}

/** 一段文本是否像仓库地址——用于打开对话框时的剪贴板预填，宁缺毋滥（含空白一律不算）。 */
export function isLikelyRepoUrl(text: string): boolean {
  const s = text.trim()
  if (s === '' || /\s/.test(s)) return false
  return /^(?:https?|ssh|git|ftps?|file):\/\//i.test(s) || /^[\w.+-]+@[\w.-]+:./.test(s)
}

/** 目标目录名是否非法：空、含路径分隔符、或为 . / ..（名称即目录名，只允许单层）。 */
export function isCloneDirNameInvalid(name: string): boolean {
  const trimmed = name.trim()
  return trimmed === '' || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)
}

/**
 * 克隆命令参数。`--` 隔开选项与操作数，防止以 `-` 开头的地址被当选项；
 * `--progress` 强开进度（stdout / stderr 非 TTY 时 git 默认不报进度）。
 */
export function buildCloneArgs(
  url: string,
  targetPath: string,
  recurseSubmodules: boolean
): string[] {
  const args = ['clone', '--progress']
  if (recurseSubmodules) args.push('--recurse-submodules')
  args.push('--', url.trim(), targetPath)
  return args
}
