import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/Users/me/Library/Application Support/DevCube Dev' }
}))

import {
  devOpenerAppPath,
  devOpenerFingerprint,
  devOpenerPlistPatch,
  devOpenerScript
} from './dev-opener-app'

describe('dev-opener-app', () => {
  it('小壳放在 Dev 数据目录', () => {
    expect(devOpenerAppPath()).toBe(
      '/Users/me/Library/Application Support/DevCube Dev/DevCube Dev.app'
    )
  })

  it('脚本把收到的文件转给 Electron.app，直接运行只拉起 Electron', () => {
    const s = devOpenerScript('/repo/node_modules/electron/dist/Electron.app')
    expect(s).toContain('on open theFiles')
    expect(s).toContain('quoted form of POSIX path of f')
    expect(s).toContain(
      '"/usr/bin/open -a " & quoted form of "/repo/node_modules/electron/dist/Electron.app" & argsText'
    )
    expect(s).toContain('on run')
  })

  it('Info.plist 补丁声明三类文档、角色 Viewer、优先级 Alternate', () => {
    const patch = devOpenerPlistPatch({ image: ['png', 'svg'], pdf: ['pdf'] })
    expect(patch.CFBundleIdentifier).toBe('com.wbbb.devcube.dev')
    expect(patch.CFBundleDocumentTypes).toEqual([
      {
        CFBundleTypeName: 'DevCube Dev image',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        CFBundleTypeExtensions: ['png', 'svg']
      },
      {
        CFBundleTypeName: 'DevCube Dev pdf',
        CFBundleTypeRole: 'Viewer',
        LSHandlerRank: 'Alternate',
        CFBundleTypeExtensions: ['pdf']
      }
    ])
  })

  it('指纹随 Electron 路径变化，同输入稳定', () => {
    const a = devOpenerFingerprint('/repo/node_modules/electron/dist/Electron.app')
    expect(a).toBe(devOpenerFingerprint('/repo/node_modules/electron/dist/Electron.app'))
    expect(a).not.toBe(devOpenerFingerprint('/other/Electron.app'))
  })
})
