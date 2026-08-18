import { describe, expect, it } from 'vitest'
import { cliLinkPath, cliScriptContent, cliScriptPath } from './cli-shim'

describe('cli-shim', () => {
  it('脚本经 open(1) 转发（打包按 bundle id、Dev 按 App 路径，与安装位置无关）', () => {
    const script = cliScriptContent('DevCube', ['-b', 'com.wbbb.devcube'])
    expect(script.startsWith('#!/bin/sh\n')).toBe(true)
    expect(script).toContain(`exec /usr/bin/open '-b' 'com.wbbb.devcube' "$@"`)
  })

  it('软链与脚本路径随 Edition 的 cliName', () => {
    expect(cliLinkPath('devcube-beta')).toBe('/usr/local/bin/devcube-beta')
    expect(cliScriptPath({ cliName: 'devcube', scriptDir: '/data/bin' })).toBe('/data/bin/devcube')
  })
})
