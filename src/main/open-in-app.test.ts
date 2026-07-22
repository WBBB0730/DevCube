import { describe, expect, it, vi } from 'vitest'
import {
  candidateAppPaths,
  isAppAvailable,
  listOpenInApps,
  openInApp,
  type OpenInAppDeps
} from './open-in-app'

function mockDeps(partial: Partial<OpenInAppDeps> & Pick<OpenInAppDeps, 'platform'>): OpenInAppDeps {
  return {
    env: {},
    homedir: () => '/Users/me',
    pathExists: async () => false,
    commandOnPath: async () => false,
    openExternal: async () => undefined,
    spawnDetached: async () => undefined,
    ...partial
  }
}

describe('candidateAppPaths', () => {
  it('darwin 含 Applications 与用户 Applications', () => {
    expect(candidateAppPaths('cursor', 'darwin', {}, '/Users/me')).toContain(
      '/Applications/Cursor.app'
    )
    expect(candidateAppPaths('claude', 'darwin', {}, '/Users/me')).toContain(
      '/Users/me/Applications/Claude.app'
    )
    expect(candidateAppPaths('codex', 'darwin', {}, '/Users/me')).toContain(
      '/Applications/ChatGPT.app'
    )
  })

  it('win32 用 LOCALAPPDATA 候选', () => {
    const paths = candidateAppPaths(
      'cursor',
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'C:\\Users\\me'
    )
    expect(paths.some((p) => p.includes('Cursor.exe'))).toBe(true)
  })
})

describe('isAppAvailable / listOpenInApps', () => {
  it('有 .app 即可用', async () => {
    const deps = mockDeps({
      platform: 'darwin',
      pathExists: async (p) => p === '/Applications/Cursor.app'
    })
    expect(await isAppAvailable('cursor', deps)).toBe(true)
    expect(await isAppAvailable('claude', deps)).toBe(false)
  })

  it('Cursor 仅 CLI 也可用；Claude 不因 claude CLI 视为 Desktop 已装', async () => {
    const deps = mockDeps({
      platform: 'linux',
      commandOnPath: async (cmd) => cmd === 'cursor' || cmd === 'claude'
    })
    expect(await isAppAvailable('cursor', deps)).toBe(true)
    expect(await isAppAvailable('claude', deps)).toBe(false)
  })

  it('list 三项；不可用带原因', async () => {
    const list = await listOpenInApps(
      mockDeps({
        platform: 'darwin',
        pathExists: async (p) => p === '/Applications/Claude.app'
      })
    )
    expect(list.map((s) => s.id)).toEqual(['claude', 'codex', 'cursor'])
    expect(list.find((s) => s.id === 'claude')?.available).toBe(true)
    expect(list.find((s) => s.id === 'cursor')).toMatchObject({
      available: false,
      unavailableReason: '未检测到 Cursor'
    })
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
    expect(openExternal).toHaveBeenCalledWith(
      'claude://code/new?folder=%2FUsers%2Fme%2Fproj'
    )
  })
})
