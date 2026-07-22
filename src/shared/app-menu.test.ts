import { describe, expect, it } from 'vitest'
import { resolveAppMenuRoles } from './app-menu'

describe('resolveAppMenuRoles', () => {
  it('Win/Linux 生产 → null（suppress 默认菜单）', () => {
    expect(resolveAppMenuRoles({ isDev: false, platform: 'win32' })).toBeNull()
    expect(resolveAppMenuRoles({ isDev: false, platform: 'linux' })).toBeNull()
  })

  it('macOS 生产 → app/edit/window，无 view', () => {
    expect(resolveAppMenuRoles({ isDev: false, platform: 'darwin' })).toEqual([
      'appMenu',
      'editMenu',
      'windowMenu'
    ])
  })

  it('macOS 开发 → 含 viewMenu', () => {
    expect(resolveAppMenuRoles({ isDev: true, platform: 'darwin' })).toEqual([
      'appMenu',
      'editMenu',
      'viewMenu',
      'windowMenu'
    ])
  })

  it('Win/Linux 开发 → edit/view/window（无 appMenu）', () => {
    expect(resolveAppMenuRoles({ isDev: true, platform: 'win32' })).toEqual([
      'editMenu',
      'viewMenu',
      'windowMenu'
    ])
    expect(resolveAppMenuRoles({ isDev: true, platform: 'linux' })).toEqual([
      'editMenu',
      'viewMenu',
      'windowMenu'
    ])
  })
})
