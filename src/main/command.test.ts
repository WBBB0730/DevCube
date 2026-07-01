import { describe, expect, it } from 'vitest'
import { buildScriptCommand, buildShellInvocation, resolveCwd } from './command'

describe('buildScriptCommand', () => {
  it('用探测到的 PM 运行 script', () => {
    expect(buildScriptCommand('pnpm', 'dev')).toBe('pnpm run dev')
    expect(buildScriptCommand('yarn', 'build')).toBe('yarn run build')
  })
  it('无 PM 时回退 npm', () => {
    expect(buildScriptCommand(null, 'dev')).toBe('npm run dev')
  })
})

describe('resolveCwd', () => {
  it('缺省即项目根', () => {
    expect(resolveCwd('/p')).toBe('/p')
  })
  it('相对路径按项目根解析', () => {
    expect(resolveCwd('/p', 'packages/api')).toBe('/p/packages/api')
  })
  it('绝对路径原样返回', () => {
    expect(resolveCwd('/p', '/abs/dir')).toBe('/abs/dir')
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
