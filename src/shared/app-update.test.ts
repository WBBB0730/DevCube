import { describe, expect, it } from 'vitest'
import {
  canAutoDownload,
  githubReleaseUrl,
  isUpdateAllowedForEdition,
  resolveUpdatePackaging,
  shouldShowUpdateButton,
  updateButtonAction
} from './app-update'
import { resolveReleaseEdition } from './release-edition'

describe('resolveUpdatePackaging', () => {
  it('未包装视为开发形态', () => {
    expect(
      resolveUpdatePackaging({ isPackaged: false, platform: 'darwin' })
    ).toBe('dev')
  })

  it('mac 包装为 macApp', () => {
    expect(
      resolveUpdatePackaging({ isPackaged: true, platform: 'darwin' })
    ).toBe('macApp')
  })

  it('Windows 无 portable 环境为 nsis', () => {
    expect(
      resolveUpdatePackaging({ isPackaged: true, platform: 'win32' })
    ).toBe('nsis')
  })

  it('Windows 有 PORTABLE_EXECUTABLE_DIR 为 portable', () => {
    expect(
      resolveUpdatePackaging({
        isPackaged: true,
        platform: 'win32',
        portableExecutableDir: 'C:\\Apps\\DevCube'
      })
    ).toBe('portable')
  })

  it('Linux 本轮不更新', () => {
    expect(resolveUpdatePackaging({ isPackaged: true, platform: 'linux' })).toBe('dev')
  })
})

describe('isUpdateAllowedForEdition', () => {
  const stable = resolveReleaseEdition('1.0.0')
  const beta = resolveReleaseEdition('1.0.0-beta.1')

  it('正式只收非 Pre-release 正式版本', () => {
    expect(isUpdateAllowedForEdition(stable, { version: '1.1.0', prerelease: false })).toBe(true)
    expect(isUpdateAllowedForEdition(stable, { version: '1.1.0-beta.1', prerelease: true })).toBe(
      false
    )
    expect(isUpdateAllowedForEdition(stable, { version: '1.1.0', prerelease: true })).toBe(false)
  })

  it('Beta 只收 Pre-release 的 beta 版本', () => {
    expect(isUpdateAllowedForEdition(beta, { version: '1.1.0-beta.2', prerelease: true })).toBe(
      true
    )
    expect(isUpdateAllowedForEdition(beta, { version: '1.1.0', prerelease: false })).toBe(false)
    expect(isUpdateAllowedForEdition(beta, { version: '1.1.0-beta.2', prerelease: false })).toBe(
      false
    )
  })

  it('拒绝不支持的 prerelease 标识', () => {
    expect(isUpdateAllowedForEdition(beta, { version: '1.1.0-alpha.1', prerelease: true })).toBe(
      false
    )
  })
})

describe('shouldShowUpdateButton / updateButtonAction', () => {
  it('可自动更新形态仅 ready 显示，动作为安装', () => {
    expect(shouldShowUpdateButton('nsis', 'ready')).toBe(true)
    expect(shouldShowUpdateButton('macApp', 'ready')).toBe(true)
    expect(shouldShowUpdateButton('nsis', 'available')).toBe(false)
    expect(shouldShowUpdateButton('nsis', 'downloading')).toBe(false)
    expect(updateButtonAction('nsis')).toBe('quitAndInstall')
    expect(canAutoDownload('nsis')).toBe(true)
  })

  it('便携版在 available 显示，动作为打开 Release', () => {
    expect(shouldShowUpdateButton('portable', 'available')).toBe(true)
    expect(shouldShowUpdateButton('portable', 'ready')).toBe(false)
    expect(updateButtonAction('portable')).toBe('openRelease')
    expect(canAutoDownload('portable')).toBe(false)
  })

  it('开发形态永不显示', () => {
    expect(shouldShowUpdateButton('dev', 'ready')).toBe(false)
    expect(shouldShowUpdateButton('dev', 'available')).toBe(false)
    expect(canAutoDownload('dev')).toBe(false)
  })
})

describe('githubReleaseUrl', () => {
  it('补全 v 前缀', () => {
    expect(githubReleaseUrl('1.0.0')).toBe(
      'https://github.com/WBBB0730/DevCube/releases/tag/v1.0.0'
    )
    expect(githubReleaseUrl('v1.0.0-beta.1')).toBe(
      'https://github.com/WBBB0730/DevCube/releases/tag/v1.0.0-beta.1'
    )
  })
})
