import { describe, expect, it } from 'vitest'
import { countRunningRunSessions, quitConfirmation } from './quit-guard'

describe('quitConfirmation', () => {
  it('有运行中的 Run Session 则需要确认', () => {
    expect(
      quitConfirmation(
        [
          { kind: 'run', status: 'running' },
          { kind: 'terminal', status: 'running' }
        ],
        0,
        0
      )
    ).toEqual({ message: '还有 1 个运行会话在运行', detail: '退出应用将结束这些会话。确定退出？' })
  })

  it('只有 Terminal / SSH Terminal 在跑、Run Session 已退出：不需要确认', () => {
    expect(
      quitConfirmation(
        [
          { kind: 'terminal', status: 'running' },
          { kind: 'ssh', status: 'running' },
          { kind: 'run', status: 'exited' }
        ],
        0,
        0
      )
    ).toBeNull()
    expect(quitConfirmation([], 0, 0)).toBeNull()
  })

  it('有未完成的文件传输也要确认', () => {
    expect(quitConfirmation([], 2, 0)).toEqual({
      message: '还有 2 个文件传输未完成',
      detail: '退出应用将中止这些传输。确定退出？'
    })
  })

  it('服务器上有未保存的文件也要确认', () => {
    expect(quitConfirmation([], 0, 1)).toEqual({
      message: '还有 1 个服务器上的文件未保存',
      detail: '退出应用将丢失未保存的修改。确定退出？'
    })
  })

  it('几种都有时一并说明', () => {
    expect(quitConfirmation([{ kind: 'run', status: 'running' }], 1, 1)).toEqual({
      message: '还有 1 个运行会话在运行、1 个文件传输未完成、1 个服务器上的文件未保存',
      detail: '退出应用将结束这些会话、中止这些传输、丢失未保存的修改。确定退出？'
    })
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
