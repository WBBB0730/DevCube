import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from '../shared/discover-source'
import {
  buildScriptCommand,
  buildShellInvocation,
  buildShellSession,
  cwdFromPickedDir,
  resolveCwd,
  resolveDiscoveredCommand
} from './command'
import type { ProjectFingerprints } from './discovery'

const none: ProjectFingerprints = {
  hasGoMod: false,
  hasCargoToml: false,
  isFlutter: false,
  hasDotnet: false,
  hasCompose: false
}

describe('buildScriptCommand', () => {
  it('用探测到的 PM 运行 script', () => {
    expect(buildScriptCommand('pnpm', 'dev')).toBe('pnpm run dev')
    expect(buildScriptCommand('yarn', 'build')).toBe('yarn run build')
  })
  it('无 PM 时回退 npm', () => {
    expect(buildScriptCommand(null, 'dev')).toBe('npm run dev')
  })
})

describe('resolveDiscoveredCommand', () => {
  it('清单脚本走包管理器', () => {
    expect(resolveDiscoveredCommand(SCRIPT_SOURCE, 'dev', 'pnpm', none)).toBe('pnpm run dev')
  })

  it('约定命令查指纹目录', () => {
    expect(resolveDiscoveredCommand('go', 'test', null, { ...none, hasGoMod: true })).toBe(
      'go test ./...'
    )
  })

  it('指纹未命中时约定命令为 null', () => {
    expect(resolveDiscoveredCommand('go', 'test', null, none)).toBeNull()
  })
})

describe('resolveCwd', () => {
  it('缺省即项目根', () => {
    expect(resolveCwd('/p')).toBe('/p')
  })
  it('相对路径按项目根解析', () => {
    expect(resolveCwd('/p', 'packages/api')).toBe(join('/p', 'packages/api'))
  })
  it('绝对路径原样返回', () => {
    expect(resolveCwd('/p', '/abs/dir')).toBe('/abs/dir')
  })
})

describe('cwdFromPickedDir', () => {
  it('选中项目根时返回空串', () => {
    expect(cwdFromPickedDir('/p', '/p')).toBe('')
  })
  it('项目根下子目录返回相对路径', () => {
    expect(cwdFromPickedDir('/p', join('/p', 'packages/api'))).toBe(join('packages', 'api'))
  })
  it('项目外目录保留绝对路径', () => {
    expect(cwdFromPickedDir('/p', '/other')).toBe('/other')
  })
})

describe('buildShellInvocation', () => {
  it('posix 用登录交互 shell 执行，加载 PATH/nvm', () => {
    expect(buildShellInvocation('pnpm run dev', 'darwin', '/bin/zsh')).toEqual({
      file: '/bin/zsh',
      args: ['-l', '-i', '-c', 'pnpm run dev']
    })
  })
  it('无 $SHELL 时回退 /bin/zsh', () => {
    expect(buildShellInvocation('ls', 'linux', undefined).file).toBe('/bin/zsh')
  })
  it('win32 用 powershell', () => {
    expect(buildShellInvocation('dir', 'win32', undefined).file).toBe('powershell.exe')
  })
})

describe('buildShellSession', () => {
  it('posix 起登录交互 shell，不带 -c', () => {
    expect(buildShellSession('darwin', '/bin/zsh')).toEqual({
      file: '/bin/zsh',
      args: ['-l', '-i']
    })
  })
  it('无 $SHELL 时回退 /bin/zsh', () => {
    expect(buildShellSession('linux', undefined).file).toBe('/bin/zsh')
  })
  it('win32 用 powershell', () => {
    expect(buildShellSession('win32', undefined)).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo']
    })
  })
})
