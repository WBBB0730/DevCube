import { describe, expect, it } from 'vitest'
import { resolveReleaseEdition } from './release-edition'

describe('resolveReleaseEdition', () => {
  it('正式版身份字段', () => {
    expect(resolveReleaseEdition('1.0.0')).toEqual({
      channel: 'stable',
      prerelease: false,
      appId: 'com.wbbb.devcube',
      productName: 'DevCube',
      executableName: 'devcube',
      name: 'devcube',
      buildResources: 'build',
      icon: 'build/icon.png',
      winIcon: 'build/icon-win.png'
    })
  })

  it('beta 身份字段', () => {
    expect(resolveReleaseEdition('1.0.0-beta.1')).toEqual({
      channel: 'beta',
      prerelease: true,
      appId: 'com.wbbb.devcube.beta',
      productName: 'DevCube Beta',
      executableName: 'devcube-beta',
      name: 'devcube-beta',
      buildResources: 'build/beta',
      icon: 'build/beta/icon.png',
      winIcon: 'build/beta/icon-win.png'
    })
    expect(resolveReleaseEdition('1.2.3-beta+sha.abc').channel).toBe('beta')
    expect(resolveReleaseEdition('1.2.3-beta.12').channel).toBe('beta')
  })

  it('拒绝不支持的 prerelease', () => {
    expect(() => resolveReleaseEdition('1.0.0-alpha.1')).toThrow('Unsupported release version')
    expect(() => resolveReleaseEdition('1.0.0-rc.1')).toThrow('Unsupported release version')
    expect(() => resolveReleaseEdition('1.0.0-beta.next')).toThrow('Unsupported release version')
  })
})
