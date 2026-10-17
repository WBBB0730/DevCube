/**
 * Git 动作作为 **Task**（docs/prd/task-progress.md、ADR-0058）：哪些动作是 Task、它们的标题，
 * 以及 `--progress` 输出的解析——各阶段按权重合成一个只增不减的总百分比，连同已传字节。
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
 * 计入总进度的阶段组及权重（同 IntelliJ 的 GitStandardProgressAnalyzer）：清点 5%、压缩 10%、收发 80%、处理增量 5%。
 * 组按出现顺序排列；收尾组不计权重，出现后进度条转为不确定。
 */
const WEIGHTED_GROUPS = [
  { key: 'count', weight: 5 },
  { key: 'compress', weight: 10 },
  { key: 'transfer', weight: 80 },
  { key: 'resolve', weight: 5 }
] as const

type PhaseGroup = (typeof WEIGHTED_GROUPS)[number]['key'] | 'finish'

/** git 的阶段名 → 中文名与所属组。未列出的阶段原样显示英文、不动总进度。 */
const PHASES: Record<string, { label: string; group: PhaseGroup }> = {
  'Enumerating objects': { label: '枚举对象', group: 'count' },
  'Counting objects': { label: '清点对象', group: 'count' },
  'Compressing objects': { label: '压缩对象', group: 'compress' },
  'Receiving objects': { label: '接收对象', group: 'transfer' },
  'Writing objects': { label: '发送对象', group: 'transfer' },
  'Unpacking objects': { label: '解包对象', group: 'transfer' },
  'Resolving deltas': { label: '处理增量', group: 'resolve' },
  'Updating files': { label: '检出文件', group: 'finish' },
  'Checking out files': { label: '检出文件', group: 'finish' },
  'Filtering content': { label: '过滤内容', group: 'finish' }
}

/** 克隆带子模块时，主仓库之后各子模块的克隆整体算一个收尾阶段。 */
const SUBMODULE_LINE = /^Submodule '.+' \(.+\) registered for path '.+'/
const SUBMODULE_PHASE = '克隆子模块'

// 进度行：可选 `remote: ` 前缀 + 阶段名 + 冒号 + （百分比 | 计数）。不报百分比的阶段
// （`Enumerating objects: 1234, done.`）要求计数后带逗号，免得把别的「名字: 数字」当成进度。
// 收发阶段在吞吐量算出后带上已传字节：`45% (450/1000), 12.34 MiB | 2.40 MiB/s`。
const PROGRESS_LINE =
  /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*[A-Za-z]):\s+(?:(\d{1,3})%(?:\s+\(\d+\/\d+\))?(?:,\s+(\d+(?:\.\d+)?)\s(bytes?|KiB|MiB|GiB|TiB)\b)?|\d+,)/

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
  bytes: number | null
}

export function parseGitProgressLine(line: string): GitProgressLine | null {
  const m = PROGRESS_LINE.exec(line.trim())
  if (!m) return null
  return {
    name: m[1],
    percent: m[2] === undefined ? null : Math.min(100, Number(m[2])),
    bytes: m[3] === undefined ? null : Math.round(Number(m[3]) * BYTE_UNIT[m[4]])
  }
}

/** 只在报进度时才打的统计行（不报进度时没有），与进度帧一并剔掉。 */
const PROGRESS_ONLY_LINE =
  /^(?:remote:\s*)?(?:Total \d+ \(delta \d+\)|Delta compression using up to \d+ threads)/

/**
 * 从 git 的 stderr 里剔掉进度帧（`\r` 原地刷新的整串）与只在报进度时才打的统计行，剩下的才是它真正想说的
 * （报错等），与不报进度时的输出一致。保留的每行仍以换行收尾（getErrorMessage 按此丢掉最后一段）。
 */
export function stripGitProgress(stderr: string): string {
  return stderr
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

/**
 * 一条 git 命令的进度追踪：逐块喂 stderr，给出合成后的进度（这一块里没有新进度为 null）。
 * git 每帧以 `\r` 或 `\n` 收尾，没收尾的半行留到下一块再解析，一帧不丢。
 * 总百分比只增不减：出现后面的阶段即视前面的阶段已完成，此后前面阶段的行不再计入。
 */
export function createGitProgressTracker(): { feed: (chunk: string) => TaskProgress | null } {
  let pending = ''
  /** 已到达的加权组下标（-1 = 还没有） */
  let groupIndex = -1
  let percent = 0
  /** 收尾阶段名；有它即不确定、不再计入加权组 */
  let finishing: string | null = null
  let phase: string | null = null
  let doneBytes: number | null = null

  const apply = (line: string): boolean => {
    if (SUBMODULE_LINE.test(line.trim())) {
      finishing = SUBMODULE_PHASE
      phase = SUBMODULE_PHASE
      doneBytes = null
      return true
    }
    const frame = parseGitProgressLine(line)
    if (frame === null) return false
    const known = PHASES[frame.name]
    if (known === undefined) {
      // 未知阶段：只换阶段名，不动总进度
      if (finishing !== null) return false
      phase = frame.name
      return true
    }
    if (known.group === 'finish') {
      // 子模块里的检出不改「克隆子模块」
      if (finishing === SUBMODULE_PHASE) return false
      finishing = known.label
      phase = known.label
      return true
    }
    if (finishing !== null) return false
    const index = WEIGHTED_GROUPS.findIndex((g) => g.key === known.group)
    if (index < groupIndex) return false
    groupIndex = index
    const before = WEIGHTED_GROUPS.slice(0, index).reduce((sum, g) => sum + g.weight, 0)
    const within = (WEIGHTED_GROUPS[index].weight * (frame.percent ?? 0)) / 100
    percent = Math.max(percent, before + within)
    phase = known.label
    // 一进收发阶段即记 0 字节：git 要攒约半秒才第一次报已传字节，有了这个起点，那时即可算出速度
    if (known.group === 'transfer' && doneBytes === null) doneBytes = 0
    if (frame.bytes !== null) doneBytes = frame.bytes
    return true
  }

  return {
    feed: (chunk) => {
      const lines = (pending + chunk).split(/[\r\n]/)
      pending = lines.pop() ?? ''
      let changed = false
      for (const line of lines) if (apply(line)) changed = true
      if (!changed) return null
      return {
        phase,
        percent: finishing !== null || groupIndex < 0 ? null : percent,
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
