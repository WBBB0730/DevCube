import { describe, expect, it } from 'vitest'
import { WslIdleTracker } from './wsl-idle'

interface Setup {
  tracker: WslIdleTracker
  timers: Map<number, { fn: () => void; ms: number }>
  idled: string[]
  fire: () => void
  setMinutes: (minutes: number | null) => void
}

function setup(minutes: number | null = 15): Setup {
  let idleMs: number | null = minutes === null ? null : minutes * 60_000
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  const idled: string[] = []
  const tracker = new WslIdleTracker({
    idleMs: () => idleMs,
    onIdle: (distro) => idled.push(distro),
    setTimer: (fn, ms) => {
      timers.set(next, { fn, ms })
      return next++
    },
    clearTimer: (timer) => timers.delete(timer as number)
  })
  const fire = (): void => {
    for (const [id, { fn }] of [...timers]) {
      timers.delete(id)
      fn()
    }
  }
  return {
    tracker,
    timers,
    idled,
    fire,
    setMinutes: (m: number | null) => {
      idleMs = m === null ? null : m * 60_000
    }
  }
}

describe('WslIdleTracker', () => {
  it('最后一个来源放下才开始计时，到时通知断开', () => {
    const { tracker, timers, idled, fire } = setup()
    tracker.hold('Ubuntu', 'current')
    tracker.hold('ubuntu', 'terminal:1')
    tracker.release('Ubuntu', 'current')
    expect(timers.size).toBe(0)
    tracker.release('Ubuntu', 'terminal:1')
    expect([...timers.values()][0].ms).toBe(15 * 60_000)
    fire()
    expect(idled).toEqual(['Ubuntu'])
    expect(tracker.isInUse('Ubuntu')).toBe(false)
  })

  it('计时期间重新在用即取消计时', () => {
    const { tracker, timers, idled } = setup()
    tracker.hold('Ubuntu', 'current')
    tracker.release('Ubuntu', 'current')
    expect(timers.size).toBe(1)
    tracker.hold('Ubuntu', 'current')
    expect(timers.size).toBe(0)
    expect(idled).toEqual([])
  })

  it('放下没拿过的来源不计时', () => {
    const { tracker, timers } = setup()
    tracker.release('Ubuntu', 'current')
    expect(timers.size).toBe(0)
  })

  it('不经「在用」就连上的，连上即开始计时；在用或已在计时的不重复计', () => {
    const { tracker, timers, idled, fire } = setup()
    tracker.connected('Ubuntu')
    expect(timers.size).toBe(1)
    tracker.connected('Ubuntu')
    expect(timers.size).toBe(1)
    fire()
    expect(idled).toEqual(['Ubuntu'])
    tracker.hold('Debian', 'current')
    tracker.connected('Debian')
    expect(timers.size).toBe(0)
  })

  it('「从不」改成具体时长：已闲置的发行版开始计时', () => {
    const { tracker, timers, setMinutes } = setup(null)
    tracker.hold('Ubuntu', 'current')
    tracker.release('Ubuntu', 'current')
    expect(timers.size).toBe(0)
    setMinutes(15)
    tracker.restartTimers()
    expect([...timers.values()].map((t) => t.ms)).toEqual([15 * 60_000])
  })

  it('「从不」不计时；改时长后正在计时的按新时长从头计', () => {
    const never = setup(null)
    never.tracker.hold('Ubuntu', 'current')
    never.tracker.release('Ubuntu', 'current')
    expect(never.timers.size).toBe(0)

    const { tracker, timers, setMinutes } = setup(15)
    tracker.hold('Ubuntu', 'current')
    tracker.release('Ubuntu', 'current')
    setMinutes(5)
    tracker.restartTimers()
    expect([...timers.values()].map((t) => t.ms)).toEqual([5 * 60_000])
    setMinutes(null)
    tracker.restartTimers()
    expect(timers.size).toBe(0)
  })

  it('各发行版分开计', () => {
    const { tracker, timers } = setup()
    tracker.hold('Ubuntu', 'current')
    tracker.hold('Debian', 'terminal:1')
    tracker.release('Debian', 'terminal:1')
    expect(timers.size).toBe(1)
    expect(tracker.isInUse('Ubuntu')).toBe(true)
  })
})
