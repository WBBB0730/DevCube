import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFS } from '../shared/types'
import { getAppPrefs, initStore, setAppPrefs } from './store'

// electron-store 是纯 ESM 且要写盘；这里换成同形状的内存实现，只验读写两侧的归一逻辑。
const state = new Map<string, unknown>()

vi.mock('electron-store', () => ({
  default: class {
    constructor({ defaults }: { defaults: Record<string, unknown> }) {
      for (const [key, value] of Object.entries(defaults)) {
        if (!state.has(key)) state.set(key, value)
      }
    }
    get(key: string): unknown {
      return state.get(key)
    }
    set(key: string, value: unknown): void {
      state.set(key, value)
    }
  }
}))

/** 用给定的落盘内容重建 store（模拟「读到某种档案」）。 */
async function withStoredPrefs(stored: unknown): Promise<void> {
  state.clear()
  await initStore()
  state.set('appPrefs', stored)
}

beforeEach(() => {
  state.clear()
})

describe('应用主题偏好', () => {
  it('缺字段的老档案回落默认深色', async () => {
    await withStoredPrefs({ windowsShell: 'powershell' })
    expect(getAppPrefs().theme).toBe('dark')
  })

  it('保留落盘的合法主题', async () => {
    await withStoredPrefs({ windowsShell: 'git-bash', theme: 'light' })
    expect(getAppPrefs().theme).toBe('light')
  })

  it('脏值回落默认深色', async () => {
    for (const dirty of ['system', '', 'Light', 42, null]) {
      await withStoredPrefs({ theme: dirty })
      expect(getAppPrefs().theme).toBe('dark')
    }
  })

  it('写入后能读回，且不动其它字段', async () => {
    await withStoredPrefs({ windowsShell: 'cmd', lastProjectParentDir: '/tmp/x' })

    const merged = setAppPrefs({ theme: 'light' })

    expect(merged.theme).toBe('light')
    expect(merged.windowsShell).toBe('cmd')
    expect(merged.lastProjectParentDir).toBe('/tmp/x')
    expect(getAppPrefs().theme).toBe('light')
  })

  it('写入脏值同样被归一（不把非法值落盘）', async () => {
    await withStoredPrefs({})

    setAppPrefs({ theme: 'system' as never })

    expect(getAppPrefs().theme).toBe(DEFAULT_APP_PREFS.theme)
    expect((state.get('appPrefs') as { theme: string }).theme).toBe(DEFAULT_APP_PREFS.theme)
  })

  it('theme 在 DEFAULT_APP_PREFS 里有键位，否则落盘时会被 pickKnownKeys 丢掉', () => {
    expect(Object.keys(DEFAULT_APP_PREFS)).toContain('theme')
  })
})
