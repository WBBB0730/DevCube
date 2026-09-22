import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.0.0', getAppPath: () => '/app' },
  shell: { openExternal: vi.fn() }
}))

import { isMacDefaultApp, parseHelperGetOutput } from './default-opener'

describe('parseHelperGetOutput', () => {
  it('每行 ext<TAB>bundleId<TAB>path；无默认时两段为空', () => {
    const m = parseHelperGetOutput(
      'png\tcom.wbbb.devcube\t/Applications/DevCube.app\npdf\t\t\nsvg\tcom.google.Chrome\t/Applications/Chrome.app\n'
    )
    expect(m.get('png')).toEqual({
      bundleId: 'com.wbbb.devcube',
      path: '/Applications/DevCube.app'
    })
    expect(m.get('pdf')).toEqual({ bundleId: '', path: '' })
    expect(m.get('svg')?.bundleId).toBe('com.google.Chrome')
    expect(m.has('nope')).toBe(false)
  })
})

describe('isMacDefaultApp', () => {
  it('按 bundle id 比，路径不同也算；无默认为 false', () => {
    const current = { bundleId: 'com.wbbb.devcube', path: '/Users/me/Apps/DevCube.app' }
    expect(isMacDefaultApp(current, 'com.wbbb.devcube')).toBe(true)
    expect(isMacDefaultApp(current, 'com.wbbb.devcube.dev')).toBe(false)
    expect(isMacDefaultApp(undefined, 'com.wbbb.devcube')).toBe(false)
  })
})
