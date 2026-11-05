import { describe, expect, it } from 'vitest'
import {
  addSpeedSample,
  dockProgressOf,
  formatRemaining,
  formatSpeed,
  NO_PROGRESS,
  progressDetail,
  remainingSecondsOf,
  speedOf,
  taskBarValue,
  taskDetailStats,
  taskItemsLabel,
  taskPhaseLabel,
  type SpeedSample,
  type TaskInfo
} from './task'

/** 依次记一串样本 */
function sampled(points: [number, number][]): SpeedSample[] {
  return points.reduce<SpeedSample[]>((s, [at, bytes]) => addSpeedSample(s, { at, bytes }), [])
}

describe('计速', () => {
  it('匀速', () => {
    expect(
      speedOf(
        sampled([
          [0, 0],
          [1000, 100],
          [2000, 200]
        ])
      )
    ).toBe(100)
  })

  it('有两个样本即有速度，只有一个样本时没有', () => {
    expect(
      speedOf(
        sampled([
          [0, 0],
          [500, 100]
        ])
      )
    ).toBe(200)
    expect(speedOf(sampled([[0, 100]]))).toBeNull()
    expect(speedOf([])).toBeNull()
  })

  it('忽快忽慢被窗口平滑', () => {
    expect(
      speedOf(
        sampled([
          [0, 0],
          [1000, 1000],
          [2000, 1000],
          [3000, 3000]
        ])
      )
    ).toBe(1000)
  })

  it('只看最近 5 秒：停住后速度回落', () => {
    const samples = sampled([
      [0, 0],
      [1000, 1000],
      [2000, 2000],
      [8000, 2000],
      [9000, 2000]
    ])
    expect(speedOf(samples)).toBe(0)
  })

  it('字节数变少即重新开始', () => {
    expect(
      sampled([
        [0, 0],
        [1000, 500],
        [2000, 10]
      ])
    ).toEqual([{ at: 2000, bytes: 10 }])
  })
})

describe('remainingSecondsOf', () => {
  it('知道总量且有速度时才有', () => {
    expect(remainingSecondsOf(200, 1000, 100)).toBe(8)
    expect(remainingSecondsOf(200, null, 100)).toBeNull()
    expect(remainingSecondsOf(200, 1000, null)).toBeNull()
    expect(remainingSecondsOf(200, 1000, 0)).toBeNull()
  })

  it('已完成超过总量记为 0', () => {
    expect(remainingSecondsOf(1200, 1000, 100)).toBe(0)
  })
})

describe('格式化', () => {
  it('速度', () => {
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s')
  })

  it('剩余时间按秒、分钟、小时进位，向上取整', () => {
    expect(formatRemaining(0.2)).toBe('还剩 1 秒')
    expect(formatRemaining(58.4)).toBe('还剩 59 秒')
    expect(formatRemaining(59.4)).toBe('还剩 1 分钟')
    expect(formatRemaining(61)).toBe('还剩 2 分钟')
    expect(formatRemaining(3599)).toBe('还剩 1 小时')
    expect(formatRemaining(3600 + 5 * 60)).toBe('还剩 1 小时 5 分')
  })

  it('进度明细：一进传数据的阶段就显示，已传从 0 起，速度算不出时写 0；剩余时间算不出不写', () => {
    const none = { doneBytes: null, totalBytes: null, speed: null, remainingSeconds: null }
    expect(progressDetail(none)).toBeNull()
    expect(progressDetail({ ...none, speed: 1024 })).toBeNull()
    expect(progressDetail({ ...none, doneBytes: 0 })).toBe('已传 0 B（0 B/s）')
    expect(progressDetail({ ...none, doneBytes: 1024 * 1024, speed: 1024 })).toBe(
      '已传 1.0 MB（1.0 KB/s）'
    )
    expect(
      progressDetail({
        doneBytes: 1024 * 1024,
        totalBytes: 4 * 1024 * 1024,
        speed: 1024 * 1024,
        remainingSeconds: 3
      })
    ).toBe('已传 1.0 MB / 4.0 MB（1.0 MB/s）· 还剩 3 秒')
  })

  it('进度明细：前面的字可换（更新下载为「已下」）', () => {
    expect(
      progressDetail(
        { doneBytes: 0, totalBytes: 1024, speed: null, remainingSeconds: null },
        '已下'
      )
    ).toBe('已下 0 B / 1.0 KB（0 B/s）')
  })
})

const task = (status: TaskInfo['status'], percent: number | null): TaskInfo => ({
  kind: 'git',
  repoPath: '/p',
  id: String(Math.random()),
  title: { action: '推送', target: 'main' },
  status,
  progress: { ...NO_PROGRESS, percent },
  speed: null,
  remainingSeconds: null,
  cancellable: true,
  cancelBlockedReason: null,
  hidden: false,
  createdAt: 0,
  errors: []
})

describe('Task 的展示取值', () => {
  it('阶段名：等待中、准备中、进度里的阶段', () => {
    expect(taskPhaseLabel(task('queued', 30))).toBe('等待中')
    expect(taskPhaseLabel(task('running', null))).toBe('准备中')
    expect(
      taskPhaseLabel({ ...task('running', 10), progress: { ...NO_PROGRESS, phase: '接收对象' } })
    ).toBe('接收对象')
  })

  it('个数：「完成 / 总数」，不知道总数时为「N 个」；不报个数与等待中没有', () => {
    const withItems = (items: TaskInfo['progress']['items']): TaskInfo => ({
      ...task('running', 10),
      progress: { ...NO_PROGRESS, phase: '上传 LFS 文件', items }
    })
    expect(taskItemsLabel(withItems({ done: 6246, total: 13884 }))).toBe('6,246 / 13,884')
    expect(taskItemsLabel(withItems({ done: 120, total: null }))).toBe('120 个')
    expect(taskItemsLabel(withItems(null))).toBeNull()
    expect(taskItemsLabel({ ...withItems({ done: 1, total: 2 }), status: 'queued' })).toBeNull()
    expect(taskPhaseLabel(withItems({ done: 1, total: 2 }))).toBe('上传 LFS 文件')
  })

  it('进度条：等待中轨道空着，其余照百分比（null 为不确定）', () => {
    expect(taskBarValue(task('queued', 30))).toBe(0)
    expect(taskBarValue(task('running', 30))).toBe(30)
    expect(taskBarValue(task('running', null))).toBeNull()
  })

  it('明细数字取自进度与计速', () => {
    expect(taskDetailStats({ ...task('running', 10), speed: 5, remainingSeconds: 2 })).toEqual({
      doneBytes: null,
      totalBytes: null,
      speed: 5,
      remainingSeconds: 2
    })
  })
})

describe('dockProgressOf', () => {
  it('DevCube 在前台时不显示', () => {
    expect(dockProgressOf([task('running', 50)], true)).toEqual({ kind: 'none' })
  })

  it('取进行中的平均百分比，没有百分比的不计入', () => {
    expect(
      dockProgressOf([task('running', 20), task('running', 60), task('running', null)], false)
    ).toEqual({ kind: 'value', value: 0.4 })
  })

  it('全都没有百分比时为不确定', () => {
    expect(dockProgressOf([task('running', null)], false)).toEqual({ kind: 'indeterminate' })
  })

  it('没有进行中的（等待中、失败的不算）时不显示', () => {
    expect(dockProgressOf([task('queued', 10), task('failed', 30)], false)).toEqual({
      kind: 'none'
    })
    expect(dockProgressOf([], false)).toEqual({ kind: 'none' })
  })
})
