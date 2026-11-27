import { describe, expect, it, vi } from 'vitest'
import {
  candidateAppPaths,
  candidateCliPaths,
  isAppAvailable,
  listOpenInApps,
  openInApp,
  type OpenInAppDeps
} from './open-in-app'

function mockDeps(
  partial: Partial<OpenInAppDeps> & Pick<OpenInAppDeps, 'platform'>
): OpenInAppDeps {
  let clock = 0
  return {
    env: {},
    homedir: () => '/Users/me',
    pathExists: async () => false,
    commandOnPath: async () => false,
    openExternal: async () => undefined,
    spawnDetached: async () => undefined,
    execCommand: async () => ({ ok: true }),
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    ...partial
  }
}

describe('candidateAppPaths / candidateCliPaths', () => {
  it('darwin 含 Applications 与用户 Applications（T3 Code 覆盖各发布渠道）', () => {
    expect(candidateAppPaths('cursor', 'darwin', {}, '/Users/me')).toContain(
      '/Applications/Cursor.app'
    )
    expect(candidateAppPaths('claude', 'darwin', {}, '/Users/me')).toContain(
      '/Users/me/Applications/Claude.app'
    )
    expect(candidateAppPaths('codex', 'darwin', {}, '/Users/me')).toContain(
      '/Applications/ChatGPT.app'
    )
    const t3Mac = candidateAppPaths('t3code', 'darwin', {}, '/Users/me')
    expect(t3Mac).toContain('/Applications/T3 Code.app')
    expect(t3Mac).toContain('/Applications/T3 Code (Beta).app')
    expect(t3Mac).toContain('/Users/me/Applications/T3 Code (Nightly).app')
  })

  it('win32 用 LOCALAPPDATA 候选', () => {
    const cursorPaths = candidateAppPaths(
      'cursor',
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'C:\\Users\\me'
    )
    expect(cursorPaths.some((p) => p.includes('Cursor.exe'))).toBe(true)

    const t3Paths = candidateAppPaths(
      't3code',
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'C:\\Users\\me'
    )
    expect(t3Paths).toContain('C:\\Users\\me\\AppData\\Local\\Programs\\t3code\\T3 Code (Beta).exe')
    expect(t3Paths).toContain(
      'C:\\Users\\me\\AppData\\Local\\Programs\\t3code\\T3 Code (Nightly).exe'
    )
    expect(t3Paths).toContain('C:\\Users\\me\\AppData\\Local\\Programs\\t3code\\T3 Code.exe')
  })

  it('T3 Code 固定 CLI 路径支持默认目录与 T3CODE_HOME', () => {
    expect(candidateCliPaths('t3code', 'darwin', {}, '/Users/me')).toEqual([
      '/Users/me/.t3/bin/t3',
      '/Users/me/.local/bin/t3'
    ])
    expect(
      candidateCliPaths('t3code', 'darwin', { T3CODE_HOME: '/custom/t3' }, '/Users/me')
    ).toEqual(['/custom/t3/bin/t3', '/Users/me/.local/bin/t3'])
    expect(candidateCliPaths('t3code', 'win32', {}, 'C:\\Users\\me')).toEqual([
      'C:\\Users\\me\\.t3\\bin\\t3.cmd',
      'C:\\Users\\me\\.t3\\bin\\t3.exe'
    ])
  })
})

describe('isAppAvailable / listOpenInApps', () => {
  it('有 .app 或固定 CLI 即可用', async () => {
    const deps = mockDeps({
      platform: 'darwin',
      pathExists: async (p) =>
        p === '/Applications/Cursor.app' || p === '/Applications/T3 Code (Beta).app'
    })
    expect(await isAppAvailable('cursor', deps)).toBe(true)
    expect(await isAppAvailable('t3code', deps)).toBe(true)
    expect(await isAppAvailable('claude', deps)).toBe(false)
  })

  it('Cursor / T3 Code 仅 CLI 也可用；Claude 不因 claude CLI 视为 Desktop 已装', async () => {
    const deps = mockDeps({
      platform: 'linux',
      commandOnPath: async (cmd) => cmd === 'cursor' || cmd === 'claude' || cmd === 't3'
    })
    expect(await isAppAvailable('cursor', deps)).toBe(true)
    expect(await isAppAvailable('t3code', deps)).toBe(true)
    expect(await isAppAvailable('claude', deps)).toBe(false)
  })

  it('listOpenInApps 只返回已安装项并保持字母序', async () => {
    const list = await listOpenInApps(
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/Claude.app' || p === '/Users/me/.t3/bin/t3'
      })
    )
    expect(list).toEqual(['claude', 't3code'])
  })

  it('全部未安装时返回空数组', async () => {
    const list = await listOpenInApps(mockDeps({ platform: 'darwin' }))
    expect(list).toEqual([])
  })
})

describe('openInApp', () => {
  it('Cursor 优先 CLI', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      'cursor',
      '/p',
      mockDeps({
        platform: 'darwin',
        commandOnPath: async (c) => c === 'cursor',
        spawnDetached
      })
    )
    expect(result).toEqual({ ok: true })
    expect(spawnDetached).toHaveBeenCalledWith('cursor', ['/p'])
  })

  it('Cursor 无 CLI 时 macOS open -a', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      'cursor',
      '/p',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/Cursor.app',
        spawnDetached
      })
    )
    expect(result).toEqual({ ok: true })
    expect(spawnDetached).toHaveBeenCalledWith('open', ['-a', '/Applications/Cursor.app', '/p'])
  })

  it('Codex Desktop 走 deep link', async () => {
    const openExternal = vi.fn(async () => undefined)
    const result = await openInApp(
      'codex',
      '/p',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/ChatGPT.app',
        openExternal
      })
    )
    expect(result).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith('codex://threads/new?path=%2Fp')
  })

  it('Codex 仅 CLI 时用 codex app', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const openExternal = vi.fn(async () => undefined)
    const result = await openInApp(
      'codex',
      '/p',
      mockDeps({
        platform: 'linux',
        commandOnPath: async (c) => c === 'codex',
        spawnDetached,
        openExternal
      })
    )
    expect(result).toEqual({ ok: true })
    expect(openExternal).not.toHaveBeenCalled()
    expect(spawnDetached).toHaveBeenCalledWith('codex', ['app', '/p'])
  })

  it('Codex deep link 失败时回退 codex app', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      'codex',
      '/p',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/ChatGPT.app',
        openExternal: async () => {
          throw new Error('no handler')
        },
        commandOnPath: async (c) => c === 'codex',
        spawnDetached
      })
    )
    expect(result).toEqual({ ok: true })
    expect(spawnDetached).toHaveBeenCalledWith('codex', ['app', '/p'])
  })

  it('Claude 走 Desktop deep link', async () => {
    const openExternal = vi.fn(async () => undefined)
    const result = await openInApp(
      'claude',
      '/Users/me/proj',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/Claude.app',
        openExternal
      })
    )
    expect(result).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith('claude://code/new?folder=%2FUsers%2Fme%2Fproj')
  })

  it('T3 Code 桌面端已运行时直接 t3 app 打开，不重复拉起桌面端', async () => {
    const execCommand = vi.fn(async () => ({ ok: true as const }))
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'darwin',
        commandOnPath: async (c) => c === 't3',
        pathExists: async (p) => p === '/Applications/T3 Code (Beta).app',
        execCommand,
        spawnDetached
      })
    )
    expect(result).toEqual({ ok: true })
    expect(execCommand).toHaveBeenCalledTimes(1)
    expect(execCommand).toHaveBeenCalledWith('t3', ['app', '/Users/me/proj'])
    expect(spawnDetached).not.toHaveBeenCalled()
  })

  it('T3 Code 未运行时自动拉起桌面端并等待就绪后打开', async () => {
    let calls = 0
    const execCommand = vi.fn(async () => {
      calls += 1
      if (calls < 3) {
        return { ok: false as const, error: 'Could not reach the T3 Code desktop app.' }
      }
      return { ok: true as const }
    })
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) =>
          p === '/Applications/T3 Code (Beta).app' || p === '/Users/me/.t3/bin/t3',
        execCommand,
        spawnDetached
      })
    )
    expect(result).toEqual({ ok: true })
    expect(spawnDetached).toHaveBeenCalledWith('open', ['-a', '/Applications/T3 Code (Beta).app'])
    expect(execCommand).toHaveBeenCalledTimes(3)
    expect(execCommand).toHaveBeenLastCalledWith('/Users/me/.t3/bin/t3', ['app', '/Users/me/proj'])
  })

  it('T3 Code 仅装桌面端尚未写出 shim 时，拉起后等待 shim 出现并打开', async () => {
    let launched = false
    let pollCount = 0
    const spawnDetached = vi.fn(async () => {
      launched = true
    })
    const execCommand = vi.fn(async () => ({ ok: true as const }))
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => {
          if (p === '/Applications/T3 Code.app') return true
          if (p === '/Users/me/.t3/bin/t3' && launched) {
            pollCount += 1
            return pollCount >= 2
          }
          return false
        },
        spawnDetached,
        execCommand
      })
    )
    expect(result).toEqual({ ok: true })
    expect(spawnDetached).toHaveBeenCalledWith('open', ['-a', '/Applications/T3 Code.app'])
    expect(execCommand).toHaveBeenCalledWith('/Users/me/.t3/bin/t3', ['app', '/Users/me/proj'])
  })

  it('T3 Code 仅有 CLI 且桌面端未运行时，不空等并给出明确提示', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'linux',
        commandOnPath: async (c) => c === 't3',
        execCommand: async () => ({
          ok: false,
          error: 'Could not reach the T3 Code desktop app.'
        }),
        spawnDetached
      })
    )
    expect(result).toEqual({
      ok: false,
      error: '未检测到运行中的 T3 Code 桌面端，请先手动启动 T3 Code'
    })
    expect(spawnDetached).not.toHaveBeenCalled()
  })

  it('T3 Code 非未就绪错误时不拉起桌面端，直接透出错误', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'darwin',
        commandOnPath: async (c) => c === 't3',
        pathExists: async (p) => p === '/Applications/T3 Code.app',
        execCommand: async () => ({
          ok: false,
          error: 'T3 Code could not open /Users/me/proj (project-create-failed).'
        }),
        spawnDetached
      })
    )
    expect(result).toEqual({
      ok: false,
      error: '无法打开 T3 Code：T3 Code could not open /Users/me/proj (project-create-failed).'
    })
    expect(spawnDetached).not.toHaveBeenCalled()
  })

  it('T3 Code 拉起后持续未就绪则超时返回错误', async () => {
    const result = await openInApp(
      't3code',
      '/Users/me/proj',
      mockDeps({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        homedir: () => 'C:\\Users\\me',
        pathExists: async (p) => p.endsWith('T3 Code.exe'),
        commandOnPath: async (c) => c === 't3',
        execCommand: async () => ({
          ok: false,
          error: 'Could not reach the T3 Code desktop app.'
        })
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('T3 Code 启动超时')
  })
})
