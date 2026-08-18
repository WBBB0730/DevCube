import { describe, expect, it } from 'vitest'
import { extractOpenDirs, parseDeepLink } from './external-open'

describe('parseDeepLink', () => {
  it('认 <scheme>://open?path=<绝对路径>', () => {
    expect(parseDeepLink('devcube://open?path=%2FUsers%2Fme%2Fweb', 'devcube')).toBe(
      '/Users/me/web'
    )
    expect(parseDeepLink('devcube-beta://open?path=%2Ftmp', 'devcube-beta')).toBe('/tmp')
  })

  it('scheme 不匹配 / 动作不对 / 相对路径 / 缺参 / 非 URL 一律 null', () => {
    expect(parseDeepLink('devcube-beta://open?path=%2Ftmp', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://new?path=%2Ftmp', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://open?path=web', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://open', 'devcube')).toBeNull()
    expect(parseDeepLink('not a url', 'devcube')).toBeNull()
  })
})

describe('extractOpenDirs', () => {
  const deps = { isDirectory: (p: string) => p === '/Users/me/web' || p === '/tmp' }
  const opts = { scheme: 'devcube', cwd: '/Users/me' }

  it('跳过 flag，相对路径按 cwd 解析，仅收存在的目录', () => {
    expect(extractOpenDirs(['--no-sandbox', 'web', '/nope'], opts, deps)).toEqual(['/Users/me/web'])
  })

  it('deep link 参数走协议解析且不再按 cwd 拼接', () => {
    expect(extractOpenDirs(['devcube://open?path=%2Ftmp'], opts, deps)).toEqual(['/tmp'])
    expect(extractOpenDirs(['other://open?path=%2Ftmp'], opts, deps)).toEqual([])
  })

  it('去重且保持出现顺序', () => {
    expect(extractOpenDirs(['/tmp', 'web', '/tmp'], opts, deps)).toEqual(['/tmp', '/Users/me/web'])
  })
})
