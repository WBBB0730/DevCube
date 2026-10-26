/**
 * Git 动作作为 **Task**（docs/prd/task-progress.md、ADR-0058）：哪些动作是 Task、它们的标题，
 * 以及 `--progress` 输出与 LFS 进度文件的解析——只有传输阶段（收发对象、LFS 文件）有百分比，按这一步自己的个数
 * 从 0 走到 100，其余阶段为加载态；连同各阶段的个数与已传字节。
 * 纯函数，main / renderer 均可导入。
 */

import type { GitAction } from './git'
import type { TaskProgress, TaskTitle } from './task'

/**
 * 是 Task 的 Git 动作（会联网收发提交、报得出进度）的标题；不是 Task 的为 null。
 * 只删远程分支或标签（`push --delete`）不传数据，刷新（fetch）只在刷新钮上转圈，都不是 Task。
 */
export function gitTaskTitle(action: GitAction): TaskTitle | null {
  switch (action.kind) {
    case 'pull-branch':
      return { action: '拉取', target: `${action.remote}/${action.branch}` }
    case 'push-branch':
      return {
        action: '推送',
        target: `${action.localBranch} → ${action.remote}/${action.targetBranch}`
      }
    case 'fetch-into-local':
      return {
        action: '获取',
        target: `${action.remote}/${action.remoteBranch} → ${action.localBranch}`
      }
    case 'push-tag':
      return { action: '推送标签', target: action.name }
    case 'add-tag':
      return action.pushToRemote === null ? null : { action: '推送标签', target: action.name }
    case 'init':
      return action.remoteUrl === null ? null : { action: '初始化仓库', target: action.remoteUrl }
    default:
      return null
  }
}

/** 拉取进入合并 / 变基后的阶段名（squash 也是合并）。 */
export function pullIntegrationPhase(mode: 'merge' | 'rebase' | 'squash'): string {
  return mode === 'rebase' ? '变基' : '合并'
}

/** 联网命令加 `--progress`：stderr 不是终端时 git 默认不报进度。 */
export function withProgressFlag(args: string[]): string[] {
  return [args[0], '--progress', ...args.slice(1)]
}

// —— 进度行 ——

/**
 * git 传提交的阶段组，按出现顺序排列：清点、压缩、收发、处理增量。只有收发有百分比（进度条只给传输），其余为加载态；
 * 后面的组出现后，前面组的行不再计入。LFS 文件与收尾另算。
 */
const GIT_GROUPS = ['count', 'compress', 'transfer', 'resolve'] as const

type PhaseGroup = (typeof GIT_GROUPS)[number] | 'lfs' | 'finish'

const LFS_UPLOAD_PHASE = '上传 LFS 文件'
const LFS_DOWNLOAD_PHASE = '下载 LFS 文件'

/** git 的阶段名 → 中文名与所属组。未列出的阶段原样显示英文，为加载态。 */
const PHASES: Record<string, { label: string; group: PhaseGroup; gitLfsMeter?: true }> = {
  'Enumerating objects': { label: '枚举对象', group: 'count' },
  'Counting objects': { label: '清点对象', group: 'count' },
  'Compressing objects': { label: '压缩对象', group: 'compress' },
  'Receiving objects': { label: '接收对象', group: 'transfer' },
  'Writing objects': { label: '发送对象', group: 'transfer' },
  'Unpacking objects': { label: '解包对象', group: 'transfer' },
  'Resolving deltas': { label: '处理增量', group: 'resolve' },
  'Updating files': { label: '检出文件', group: 'finish' },
  'Checking out files': { label: '检出文件', group: 'finish' },
  // 克隆检出时 git-lfs 下载 LFS 文件（git 的延迟检出），带个数与已传字节
  'Filtering content': { label: LFS_DOWNLOAD_PHASE, group: 'lfs' },
  // git-lfs 推送前上传 LFS 文件时自己的进度行（强制打开才有）：个数含服务器上已有而跳过的文件。
  // 它边数要传的文件边报总数，体积也把跳过的文件算作已传——见追踪器
  'Uploading LFS objects': { label: LFS_UPLOAD_PHASE, group: 'lfs', gitLfsMeter: true }
}

/** 克隆带子模块时，主仓库之后各子模块的克隆整体算一个收尾阶段。 */
const SUBMODULE_LINE = /^Submodule '.+' \(.+\) registered for path '.+'/
const SUBMODULE_PHASE = '克隆子模块'

// 进度行：可选 `remote: ` 前缀 + 阶段名 + 冒号 + （百分比 + 可选的「完成 / 总数」 | 计数）。不报百分比的阶段
// （`Enumerating objects: 1234, done.`）要求计数后带逗号，免得把别的「名字: 数字」当成进度。
// 收发阶段在吞吐量算出后带上已传字节：`45% (450/1000), 12.34 MiB | 2.40 MiB/s`。
const PROGRESS_LINE =
  /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*[A-Za-z]):\s+(?:(\d{1,3})%(?:\s+\((\d+)\/(\d+)\))?(?:,\s+(\d+(?:\.\d+)?)\s(bytes?|KiB|MiB|GiB|TiB)\b)?|\d+,)/

const BYTE_UNIT: Record<string, number> = {
  byte: 1,
  bytes: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4
}

/** 一行解析出的进度帧。 */
export interface GitProgressLine {
  /** git 原文的阶段名 */
  name: string
  percent: number | null
  items: { done: number; total: number } | null
  bytes: number | null
}

/**
 * 带「完成 / 总数」时百分比按个数算：打出来的百分比是取整后的（git-lfs 四舍五入，400 / 402 打成 100%），
 * 界面向下取整，没传完不显示 100%。
 */
export function parseGitProgressLine(line: string): GitProgressLine | null {
  const m = PROGRESS_LINE.exec(line.trim())
  if (!m) return null
  const items = m[3] === undefined ? null : { done: Number(m[3]), total: Number(m[4]) }
  const printed = m[2] === undefined ? null : Number(m[2])
  const percent = items !== null && items.total > 0 ? (items.done * 100) / items.total : printed
  return {
    name: m[1],
    percent: percent === null ? null : Math.min(100, percent),
    items,
    bytes: m[5] === undefined ? null : Math.round(Number(m[5]) * BYTE_UNIT[m[6]])
  }
}

// LFS 进度文件（GIT_LFS_PROGRESS）的行：`<方向> <第几个>/<预计总数> <已传>/<大小> <文件名>`。只认上传、下载；
// 合并时还有 `clean`（本机算哈希，不传数据）等，不算。第几个只数真在传的，不含服务器上已有而跳过的。
const LFS_PROGRESS_LINE = /^(upload|download) \d+\/\d+ (\d+)\/(\d+) (.+)$/

/** LFS 进度文件里一个文件的一帧。 */
export interface LfsProgressLine {
  direction: 'upload' | 'download'
  /** 这个文件已传字节 */
  doneBytes: number
  /** 这个文件的大小 */
  size: number
  name: string
}

export function parseLfsProgressLine(line: string): LfsProgressLine | null {
  const m = LFS_PROGRESS_LINE.exec(line)
  if (!m) return null
  return {
    direction: m[1] as LfsProgressLine['direction'],
    doneBytes: Number(m[2]),
    size: Number(m[3]),
    name: m[4]
  }
}

/** 只在报进度时才打的统计行（不报进度时没有），与进度帧一并剔掉。 */
const PROGRESS_ONLY_LINE =
  /^(?:remote:\s*)?(?:Total \d+ \(delta \d+\)|Delta compression using up to \d+ threads)/

/**
 * 从 git 的输出里剔掉进度帧（`\r` 原地刷新的整串，含 git-lfs 自己的进度行）与只在报进度时才打的统计行，
 * 剩下的才是它真正想说的（报错等），与不报进度时的输出一致。保留的每行仍以换行收尾（getErrorMessage 按此丢掉最后一段）。
 */
export function stripGitProgress(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.split('\r').pop() ?? '')
    .filter(
      (line) =>
        line.trim() !== '' &&
        parseGitProgressLine(line) === null &&
        !PROGRESS_ONLY_LINE.test(line.trim())
    )
    .map((line) => `${line}\n`)
    .join('')
}

/** 进度的来源：git 的错误输出与普通输出（git-lfs 的进度行在哪一路随 git 版本），LFS 进度文件新写入的内容。 */
export type GitProgressSource = 'stderr' | 'stdout' | 'lfs-progress'

/**
 * 一条 git 命令的进度追踪：逐块喂各来源的内容，给出合成后的进度（这一块里没有新进度为 null）。
 * 每帧以 `\r` 或 `\n` 收尾（进度文件以 `\n`），没收尾的半行按来源留到下一块再解析，一帧不丢。
 *
 * 进度条只给传输：收发对象、上传 / 下载 LFS 文件按这一步自己的个数从 0 走到 100（推送先传 LFS 文件再传提交，
 * 克隆、拉取先传提交再下 LFS 文件）；清点、压缩、处理增量、收尾等其余阶段为加载态（百分比为 null），个数照报。
 * git 的阶段按清点 → 压缩 → 收发 → 处理增量出现，后面的出现后前面的行不再计入。已传字节只在传数据的阶段有。
 *
 * LFS 段：上传的个数与百分比看 git-lfs 自己的进度行（含跳过的文件；数完要传的文件之前当作还在准备），
 * 已传字节看进度文件；
 * 克隆的下载都看 git 报的「Filtering content」（它报了就不再看进度文件）；拉取的下载只有进度文件
 * （逐个文件下，总数不可知，进度条不确定）。
 */
export function createGitProgressTracker(): {
  feed: (source: GitProgressSource, chunk: string) => TaskProgress | null
} {
  const pending: Record<GitProgressSource, string> = { stderr: '', stdout: '', 'lfs-progress': '' }
  /** 当前这一段：提交 / LFS 文件 / 收尾 */
  let segment: 'git' | 'lfs' | 'finish' = 'git'
  /** 提交段已到达的阶段组下标（-1 = 还没有） */
  let groupIndex = -1
  /** 当前传输阶段的百分比；不是传输阶段为 null（加载态） */
  let percent: number | null = null
  /** LFS 段：进度文件里各文件的已传字节与是否传完 */
  let lfsFiles = new Map<string, { doneBytes: number; finished: boolean }>()
  let lfsBytes = 0
  let lfsFinished = 0
  /** 这一段 git 自己报了个数与已传字节（克隆检出时的 Filtering content）：以它为准，进度文件不再计入 */
  let lfsReportedByGit = false
  /**
   * git-lfs 推送前边数要传的文件边报总数（加进第一个文件就打出 0 / 1），不说什么时候数完：总数与上一帧相同才算数完。
   * 数完前当作还在准备，什么都不报；这期间进度文件里已传的体积，数完后一并报。
   */
  let lfsMeterTotal: number | null = null
  let lfsCounting = false
  let phase: string | null = null
  let items: TaskProgress['items'] = null
  let doneBytes: number | null = null

  const enterFinish = (label: string): void => {
    segment = 'finish'
    phase = label
    percent = null
    items = null
    doneBytes = null
  }

  const enterLfs = (label: string): void => {
    if (segment !== 'lfs') {
      segment = 'lfs'
      percent = null
      lfsFiles = new Map()
      lfsBytes = 0
      lfsFinished = 0
      lfsReportedByGit = false
      items = null
      // 一进这一段即记 0 字节：速度从这里起算
      doneBytes = 0
    }
    phase = label
  }

  /** git 输出里的一行。 */
  const applyLine = (line: string): boolean => {
    if (SUBMODULE_LINE.test(line.trim())) {
      enterFinish(SUBMODULE_PHASE)
      return true
    }
    // 子模块的克隆里的一切（收发、检出、LFS）不改「克隆子模块」
    if (phase === SUBMODULE_PHASE) return false
    const frame = parseGitProgressLine(line)
    if (frame === null) return false
    const known = PHASES[frame.name]
    if (known === undefined) {
      // 未知阶段：加载态，只换阶段名与个数；LFS 段与收尾里不理
      if (segment !== 'git') return false
      phase = frame.name
      percent = null
      items = frame.items
      doneBytes = null
      return true
    }
    if (known.group === 'finish') {
      enterFinish(known.label)
      return true
    }
    if (known.group === 'lfs') {
      if (known.gitLfsMeter === true) {
        const total = frame.items?.total ?? null
        lfsCounting = lfsMeterTotal === null || (lfsCounting && total !== lfsMeterTotal)
        lfsMeterTotal = total
        if (lfsCounting) return false
        // 体积不用，已传字节看进度文件
        enterLfs(known.label)
        percent = frame.percent
        items = frame.items
        return true
      }
      enterLfs(known.label)
      percent = frame.percent
      items = frame.items
      lfsReportedByGit = true
      if (frame.bytes !== null) doneBytes = frame.bytes
      return true
    }
    if (segment === 'finish') return false
    if (segment === 'lfs') {
      // LFS 文件传完、轮到提交
      segment = 'git'
      groupIndex = -1
      doneBytes = null
    }
    const index = GIT_GROUPS.indexOf(known.group)
    if (index < groupIndex) return false
    groupIndex = index
    phase = known.label
    items = frame.items
    if (known.group === 'transfer') {
      percent = frame.percent ?? 0
      // 一进收发阶段即记 0 字节：git 要攒约半秒才第一次报已传字节，有了这个起点，那时即可算出速度
      if (doneBytes === null) doneBytes = 0
      if (frame.bytes !== null) doneBytes = frame.bytes
    } else {
      percent = null
      doneBytes = null
    }
    return true
  }

  /** LFS 进度文件里的一行。 */
  const applyLfsLine = (line: string): boolean => {
    if (phase === SUBMODULE_PHASE) return false
    const frame = parseLfsProgressLine(line)
    if (frame === null) return false
    if (segment === 'lfs' && lfsReportedByGit) return false
    enterLfs(frame.direction === 'upload' ? LFS_UPLOAD_PHASE : LFS_DOWNLOAD_PHASE)
    const before = lfsFiles.get(frame.name)
    const finished = frame.doneBytes >= frame.size
    lfsFiles.set(frame.name, { doneBytes: frame.doneBytes, finished })
    lfsBytes += frame.doneBytes - (before?.doneBytes ?? 0)
    if (finished && before?.finished !== true) lfsFinished++
    doneBytes = lfsBytes
    if (frame.direction === 'download') {
      // 拉取的检出逐个文件下（每行的预计总数都是 1）：只知道下完了几个，进度条为加载态
      items = { done: lfsFinished, total: null }
      percent = null
    }
    return !lfsCounting
  }

  return {
    feed: (source, chunk) => {
      const lfs = source === 'lfs-progress'
      const lines = (pending[source] + chunk).split(lfs ? /\r?\n/ : /[\r\n]/)
      pending[source] = lines.pop() ?? ''
      let changed = false
      for (const line of lines) if ((lfs ? applyLfsLine : applyLine)(line)) changed = true
      if (!changed) return null
      return {
        phase,
        percent,
        items,
        doneBytes,
        totalBytes: null
      }
    }
  }
}

/**
 * 一个 Task 含多条联网命令时（推送标签到多个远程），总进度按命令条数平分：第 index 条（0 起）占
 * [index / count, (index + 1) / count]。不确定的仍不确定。
 */
export function spreadProgress(
  progress: TaskProgress,
  slot: { index: number; count: number }
): TaskProgress {
  if (slot.count <= 1 || progress.percent === null) return progress
  return { ...progress, percent: (slot.index * 100 + progress.percent) / slot.count }
}
