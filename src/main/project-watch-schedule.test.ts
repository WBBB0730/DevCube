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
  it('三个通道各自置位；空轮次无待发', () => {
    const pending = emptyPending()
    expect(hasPending(pending)).toBe(false)
    addWatchChange(pending, { kind: 'discovery' })
    addWatchChange(pending, { kind: 'files' })
    expect(pending).toEqual({ discovery: true, files: true, git: null })
    expect(hasPending(pending)).toBe(true)
  })

  it('工作区路径攒成集合（去重）', () => {
    const pending = emptyPending()
    addWatchChange(pending, { kind: 'git-worktree', relPath: 'a.ts' })
    addWatchChange(pending, { kind: 'git-worktree', relPath: 'a.ts' })
    addWatchChange(pending, { kind: 'git-worktree', relPath: 'b.ts' })
    expect(pending.git).toEqual({ mode: 'paths', paths: new Set(['a.ts', 'b.ts']) })
  })

  it('元数据 / 探测转强制，之后的工作区路径不再攒', () => {
    for (const kind of ['git-meta', 'git-probe'] as const) {
      const pending = emptyPending()
      addWatchChange(pending, { kind: 'git-worktree', relPath: 'a.ts' })
      addWatchChange(pending, { kind })
      addWatchChange(pending, { kind: 'git-worktree', relPath: 'b.ts' })
      expect(pending.git).toEqual({ mode: 'force' })
    }
  })

  it('路径攒到上限转强制', () => {
    const pending = emptyPending()
    for (let i = 0; i < PENDING_PATHS_MAX; i++) {
      addWatchChange(pending, { kind: 'git-worktree', relPath: `f${i}` })
    }
    expect(pending.git?.mode).toBe('paths')
    addWatchChange(pending, { kind: 'git-worktree', relPath: 'overflow' })
    expect(pending.git).toEqual({ mode: 'force' })
  })
})

describe('markRescan', () => {
  it('需重扫：三个通道都强制', () => {
    const pending = emptyPending()
    addWatchChange(pending, { kind: 'git-worktree', relPath: 'a.ts' })
    markRescan(pending)
    expect(pending).toEqual({ discovery: true, files: true, git: { mode: 'force' } })
  })
})
