import { describe, expect, it } from 'vitest'
import {
  addWatchChange,
  emptyPending,
  hasPending,
  markRescan,
  PENDING_PATHS_MAX,
  WATCH_DEBOUNCE_MS,
  WATCH_MAX_WAIT_MS,
  watchFlushDelay
} from './project-watch-schedule'

describe('watchFlushDelay', () => {
  it('首个事件：按尾沿防抖', () => {
    expect(watchFlushDelay(1000, 1000)).toBe(WATCH_DEBOUNCE_MS)
  })

  it('持续有事件：逼近最长等待时缩短，到点即 0，不无限推迟', () => {
    const first = 1000
    expect(watchFlushDelay(first, first + WATCH_MAX_WAIT_MS - 300)).toBe(300)
    expect(watchFlushDelay(first, first + WATCH_MAX_WAIT_MS)).toBe(0)
    expect(watchFlushDelay(first, first + WATCH_MAX_WAIT_MS + 500)).toBe(0)
  })
})

describe('addWatchChange', () => {
  it('各通道各自置位；空轮次无待发', () => {
    const pending = emptyPending()
    expect(hasPending(pending)).toBe(false)
    addWatchChange(pending, { kind: 'discovery' })
    addWatchChange(pending, { kind: 'files' })
    expect(pending).toEqual({
      discovery: true,
      files: true,
      git: new Map(),
      probe: false,
      rescan: false
    })
    expect(hasPending(pending)).toBe(true)
  })

  it('工作区路径按仓库攒成集合（去重）', () => {
    const pending = emptyPending()
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'a.ts' })
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'a.ts' })
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'b.ts' })
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p/inner', relPath: 'c.ts' })
    expect(pending.git).toEqual(
      new Map([
        ['/p', { mode: 'paths', paths: new Set(['a.ts', 'b.ts']) }],
        ['/p/inner', { mode: 'paths', paths: new Set(['c.ts']) }]
      ])
    )
  })

  it('元数据转该仓库强制，之后它的工作区路径不再攒；别的仓库不受影响', () => {
    const pending = emptyPending()
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'a.ts' })
    addWatchChange(pending, { kind: 'git-meta', repo: '/p' })
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'b.ts' })
    addWatchChange(pending, { kind: 'git-worktree', repo: '/q', relPath: 'c.ts' })
    expect(pending.git.get('/p')).toEqual({ mode: 'force' })
    expect(pending.git.get('/q')).toEqual({ mode: 'paths', paths: new Set(['c.ts']) })
  })

  it('探测只置重新发现，不动各仓库的 git 通道', () => {
    const pending = emptyPending()
    addWatchChange(pending, { kind: 'git-probe' })
    expect(pending.probe).toBe(true)
    expect(pending.git.size).toBe(0)
    expect(hasPending(pending)).toBe(true)
  })

  it('路径攒到上限转强制', () => {
    const pending = emptyPending()
    for (let i = 0; i < PENDING_PATHS_MAX; i++) {
      addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: `f${i}` })
    }
    expect(pending.git.get('/p')?.mode).toBe('paths')
    addWatchChange(pending, { kind: 'git-worktree', repo: '/p', relPath: 'overflow' })
    expect(pending.git.get('/p')).toEqual({ mode: 'force' })
  })
})

describe('markRescan', () => {
  it('需重扫：各通道强制、全部仓库强制、重新发现', () => {
    const pending = emptyPending()
    markRescan(pending)
    expect(pending).toMatchObject({ discovery: true, files: true, probe: true, rescan: true })
  })
})
