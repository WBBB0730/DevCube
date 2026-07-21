import { describe, expect, it } from 'vitest'
import { countRunningRunSessions, needsQuitConfirmation } from './quit-guard'

describe('needsQuitConfirmation', () => {
  it('有运行中的 Run Session 则需要确认', () => {
    expect(
      needsQuitConfirmation([
        { kind: 'run', status: 'running' },
        { kind: 'terminal', status: 'running' }
      ])
    ).toBe(true)
  })

  it('只有 Terminal 在跑不需要确认', () => {
    expect(needsQuitConfirmation([{ kind: 'terminal', status: 'running' }])).toBe(false)
  })

  it('Run Session 已退出不需要确认', () => {
    expect(needsQuitConfirmation([{ kind: 'run', status: 'exited' }])).toBe(false)
  })

  it('空列表不需要确认', () => {
    expect(needsQuitConfirmation([])).toBe(false)
  })
})

describe('countRunningRunSessions', () => {
  it('只数运行中的 Run Session', () => {
    expect(
      countRunningRunSessions([
        { kind: 'run', status: 'running' },
        { kind: 'run', status: 'failed' },
        { kind: 'run', status: 'running' },
        { kind: 'terminal', status: 'running' }
      ])
    ).toBe(2)
  })
})
