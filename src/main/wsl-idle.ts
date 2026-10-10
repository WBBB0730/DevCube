// 「闲置后断开 WSL」的计时（docs/prd/wsl-project.md）：一个发行版的「在用」来源（当前条目、终端、运行会话、
// 预览 / 压缩窗口）全部放下时开始计时，满偏好时长即通知断开；计时期间重新在用则取消。不经「在用」就连上的
// （后台的 git 等）连上即开始计时。计时器注入以便测试。
export interface WslIdleDeps {
  /** 闲置多久断开；null 为从不 */
  idleMs(): number | null
  onIdle(distro: string): void
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
}

export class WslIdleTracker {
  /** 发行版键（小写）→ 在用来源 */
  private readonly holders = new Map<string, Set<string>>()
  /** 闲置中的发行版：计时器（偏好为「从不」时为 null，改了时长再开始计） */
  private readonly idle = new Map<string, { timer: unknown | null; distro: string }>()

  constructor(private readonly deps: WslIdleDeps) {}

  /** 某个来源开始用这个发行版：取消闲置计时。 */
  hold(distro: string, holder: string): void {
    const key = distro.toLowerCase()
    this.cancelIdle(key)
    const set = this.holders.get(key) ?? new Set<string>()
    set.add(holder)
    this.holders.set(key, set)
  }

  /** 某个来源放下这个发行版；最后一个放下时开始计时。 */
  release(distro: string, holder: string): void {
    const key = distro.toLowerCase()
    const set = this.holders.get(key)
    if (!set?.delete(holder) || set.size > 0) return
    this.holders.delete(key)
    this.startIdle(key, distro)
  }

  /** 连上了：没有来源在用、也没在计时（后台的 git 等不经「在用」就连上）即开始计时。 */
  connected(distro: string): void {
    const key = distro.toLowerCase()
    if (!this.isInUse(distro) && !this.idle.has(key)) this.startIdle(key, distro)
  }

  isInUse(distro: string): boolean {
    return (this.holders.get(distro.toLowerCase())?.size ?? 0) > 0
  }

  /** 偏好的时长改了：闲置中的按新时长从头计（「从不」改成具体时长的也开始计）。 */
  restartTimers(): void {
    for (const [key, { distro }] of [...this.idle]) {
      this.cancelIdle(key)
      this.startIdle(key, distro)
    }
  }

  private startIdle(key: string, distro: string): void {
    const ms = this.deps.idleMs()
    const timer =
      ms === null
        ? null
        : this.deps.setTimer(() => {
            this.idle.delete(key)
            this.deps.onIdle(distro)
          }, ms)
    this.idle.set(key, { timer, distro })
  }

  private cancelIdle(key: string): void {
    const entry = this.idle.get(key)
    if (!entry) return
    if (entry.timer !== null) this.deps.clearTimer(entry.timer)
    this.idle.delete(key)
  }
}
