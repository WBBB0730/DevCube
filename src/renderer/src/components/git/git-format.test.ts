// git-format 纯函数测试：hash 缩写、相对时间阈值（graph-table §4.1）、完整日期时间格式。
import { describe, expect, it } from 'vitest'
import {
  abbrevHash,
  formatDateTime,
  formatRelativeDuration,
  formatRelativeTime
} from './git-format'

describe('abbrevHash', () => {
  it('完整 40 位 hash 缩写为前 8 位', () => {
    expect(abbrevHash('08f93b5c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a')).toBe('08f93b5c')
  })

  it('短于 8 位的输入原样返回（未提交行的 "*"）', () => {
    expect(abbrevHash('*')).toBe('*')
  })
})

describe('formatRelativeDuration', () => {
  it('小于 60 秒按秒显示', () => {
    expect(formatRelativeDuration(0)).toBe('0 秒前')
    expect(formatRelativeDuration(59)).toBe('59 秒前')
  })

  it('负差值（机器时钟偏差）钳制为 0 秒前', () => {
    expect(formatRelativeDuration(-30)).toBe('0 秒前')
  })

  it('60 秒起按分钟显示，商四舍五入', () => {
    expect(formatRelativeDuration(60)).toBe('1 分钟前')
    expect(formatRelativeDuration(90)).toBe('2 分钟前')
    expect(formatRelativeDuration(3599)).toBe('60 分钟前')
  })

  it('3600 秒起按小时显示', () => {
    expect(formatRelativeDuration(3600)).toBe('1 小时前')
    expect(formatRelativeDuration(86399)).toBe('24 小时前')
  })

  it('86400 秒起按天显示', () => {
    expect(formatRelativeDuration(86400)).toBe('1 天前')
  })

  it('604800 秒起按周显示', () => {
    expect(formatRelativeDuration(604800)).toBe('1 周前')
    expect(formatRelativeDuration(2629799)).toBe('4 周前')
  })

  it('2629800 秒（平均月 365.25/12 天）起按个月显示', () => {
    expect(formatRelativeDuration(2629800)).toBe('1 个月前')
    expect(formatRelativeDuration(31557599)).toBe('12 个月前')
  })

  it('31557600 秒（365.25 天）起按年显示', () => {
    expect(formatRelativeDuration(31557600)).toBe('1 年前')
    expect(formatRelativeDuration(63115200)).toBe('2 年前')
  })
})

describe('formatRelativeTime', () => {
  it('给定过去的 Unix 秒返回相对当前时刻的中文文案', () => {
    const fiveMinAgo = Math.floor(Date.now() / 1000) - 300
    expect(formatRelativeTime(fiveMinAgo)).toBe('5 分钟前')
  })
})

describe('formatDateTime', () => {
  it('输出「D MMM YYYY HH:MM:SS」本地时区完整时间', () => {
    // 用本地时间构造时间戳，断言与运行机器的时区无关
    const unixSec = new Date(2026, 6, 3, 9, 5, 7).getTime() / 1000
    expect(formatDateTime(unixSec)).toBe('3 Jul 2026 09:05:07')
  })

  it('日不补零、时分秒补零', () => {
    const unixSec = new Date(2025, 11, 31, 23, 59, 59).getTime() / 1000
    expect(formatDateTime(unixSec)).toBe('31 Dec 2025 23:59:59')
  })
})
