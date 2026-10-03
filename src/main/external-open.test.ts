import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMPRESS_ARG,
  COMPRESS_LIST_ARG,
  extractOpenTargets,
  isCompressListFile,
  parseDeepLink,
  targetFromDeepLink
} from './external-open'

describe('parseDeepLink', () => {
  it('认 <scheme>://open?path=<绝对路径>', () => {
    expect(parseDeepLink('devcube://open?path=%2FUsers%2Fme%2Fweb', 'devcube')).toEqual({
      action: 'open',
      path: '/Users/me/web'
    })
    expect(parseDeepLink('devcube-beta://open?path=%2Ftmp', 'devcube-beta')).toEqual({
      action: 'open',
      path: '/tmp'
    })
  })

  it('认 <scheme>://compress?path=…&path=…，只留绝对路径，一个都没有为 null', () => {
    expect(
      parseDeepLink(
        'devcube://compress?path=%2Fw%2Fa&path=rel&path=%2Fw%2F%E6%8A%A5%E5%91%8A',
        'devcube'
      )
    ).toEqual({ action: 'compress', paths: ['/w/a', '/w/报告'] })
    expect(parseDeepLink('devcube://compress?path=rel', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://compress', 'devcube')).toBeNull()
  })

  it('scheme 不匹配 / 动作不对 / 相对路径 / 缺参 / 非 URL 一律 null', () => {
    expect(parseDeepLink('devcube-beta://open?path=%2Ftmp', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://new?path=%2Ftmp', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://open?path=web', 'devcube')).toBeNull()
    expect(parseDeepLink('devcube://open', 'devcube')).toBeNull()
    expect(parseDeepLink('not a url', 'devcube')).toBeNull()
  })
})

describe('extractOpenTargets', () => {
  // argv 路径要过 node:path 的 resolve，走的是**平台原生**语义（win32 下 '/Users/me' + 'web'
  // 解析成 `C:\Users\me\web`），所以期望值不能写死 POSIX 字面量，必须用同一个 resolve 算出来，
  // 否则这些用例只在 POSIX 上成立、在 Windows 上恒为空数组。
  const cwd = resolve('/Users/me')
  const webDir = resolve(cwd, 'web')
  const photo = resolve(cwd, 'a.png')
  // 同一个 /tmp 有两种形态：走 argv 会被 resolve 成平台原生路径，走 deep link 则原样传出不解析。
  const tmpFromArgv = resolve(cwd, '/tmp')
  const tmpFromLink = '/tmp'
  const listFile = join(tmpdir(), 'devcube-compress-1.txt')
  const deps = {
    classify: (p: string): 'dir' | 'file' | null =>
      p === webDir || p === tmpFromArgv || p === tmpFromLink ? 'dir' : p === photo ? 'file' : null,
    takeCompressList: (file: string): string[] =>
      file === listFile ? [webDir, photo, '/nope'] : []
  }
  const opts = { scheme: 'devcube', cwd }

  it('跳过 flag，相对路径按 cwd 解析，仅收存在的目录与文件并标注种类', () => {
    expect(extractOpenTargets(['--no-sandbox', 'web', 'a.png', '/nope'], opts, deps)).toEqual([
      { kind: 'dir', path: webDir },
      { kind: 'file', path: photo }
    ])
  })

  it('deep link 参数走协议解析且不再按 cwd 拼接', () => {
    expect(extractOpenTargets(['devcube://open?path=%2Ftmp'], opts, deps)).toEqual([
      { kind: 'dir', path: tmpFromLink }
    ])
    expect(extractOpenTargets(['other://open?path=%2Ftmp'], opts, deps)).toEqual([])
  })

  it('去重且保持出现顺序', () => {
    expect(extractOpenTargets(['/tmp', 'web', '/tmp'], opts, deps)).toEqual([
      { kind: 'dir', path: tmpFromArgv },
      { kind: 'dir', path: webDir }
    ])
  })
})

describe('压缩请求', () => {
  const cwd = resolve('/Users/me')
  const webDir = resolve(cwd, 'web')
  const photo = resolve(cwd, 'a.png')
  const listFile = join(tmpdir(), 'devcube-compress-1.txt')
  const deps = {
    classify: (p: string): 'dir' | 'file' | null =>
      p === webDir || p === '/tmp' ? 'dir' : p === photo ? 'file' : null,
    takeCompressList: (file: string): string[] =>
      file === listFile ? [webDir, photo, '/nope'] : []
  }
  const opts = { scheme: 'devcube', cwd }

  it('带 --compress 时其余路径合成一个压缩目标（只留存在的、去重），不按打开处理', () => {
    expect(
      extractOpenTargets([COMPRESS_ARG, 'web', 'a.png', 'web', 'missing'], opts, deps)
    ).toEqual([{ kind: 'compress', paths: [webDir, photo] }])
  })

  it('清单文件里的路径并进同一个压缩目标', () => {
    expect(extractOpenTargets([`${COMPRESS_LIST_ARG}${listFile}`], opts, deps)).toEqual([
      { kind: 'compress', paths: [webDir, photo] }
    ])
  })

  it('deep link 压缩：只留存在的路径，全都不在为 null', () => {
    expect(
      targetFromDeepLink({ action: 'compress', paths: ['/tmp', '/nope', '/tmp'] }, deps)
    ).toEqual({
      kind: 'compress',
      paths: ['/tmp']
    })
    expect(targetFromDeepLink({ action: 'compress', paths: ['/nope'] }, deps)).toBeNull()
  })

  it('清单文件只认临时目录里按约定命名的文件', () => {
    const dir = tmpdir()
    expect(isCompressListFile(join(dir, 'devcube-compress-42-1.txt'), dir)).toBe(true)
    expect(isCompressListFile(join(dir, 'notes.txt'), dir)).toBe(false)
    expect(isCompressListFile(join(dir, 'sub', 'devcube-compress-1.txt'), dir)).toBe(false)
  })
})
