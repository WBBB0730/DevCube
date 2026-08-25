import { resolve } from 'node:path'
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
  // argv 路径要过 node:path 的 resolve，走的是**平台原生**语义（win32 下 '/Users/me' + 'web'
  // 解析成 `C:\Users\me\web`），所以期望值不能写死 POSIX 字面量，必须用同一个 resolve 算出来，
  // 否则这些用例只在 POSIX 上成立、在 Windows 上恒为空数组。
  const cwd = resolve('/Users/me')
  const webDir = resolve(cwd, 'web')
  // 同一个 /tmp 有两种形态：走 argv 会被 resolve 成平台原生路径，走 deep link 则原样传出不解析。
  const tmpFromArgv = resolve(cwd, '/tmp')
  const tmpFromLink = '/tmp'
  const deps = {
    isDirectory: (p: string) => p === webDir || p === tmpFromArgv || p === tmpFromLink
  }
  const opts = { scheme: 'devcube', cwd }

  it('跳过 flag，相对路径按 cwd 解析，仅收存在的目录', () => {
    expect(extractOpenDirs(['--no-sandbox', 'web', '/nope'], opts, deps)).toEqual([webDir])
  })

  it('deep link 参数走协议解析且不再按 cwd 拼接', () => {
    expect(extractOpenDirs(['devcube://open?path=%2Ftmp'], opts, deps)).toEqual([tmpFromLink])
    expect(extractOpenDirs(['other://open?path=%2Ftmp'], opts, deps)).toEqual([])
  })

  it('去重且保持出现顺序', () => {
    expect(extractOpenDirs(['/tmp', 'web', '/tmp'], opts, deps)).toEqual([tmpFromArgv, webDir])
  })
})
