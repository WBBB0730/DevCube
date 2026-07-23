import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from '../shared/discover-source'
import {
  buildScriptCommand,
  buildShellInvocation,
  buildShellSession,
  cwdFromPickedDir,
  findGitBash,
  resolveCwd,
  resolveDiscoveredCommand,
  resolveWindowsShell,
  runHeaderShellFor,
  wrapWithRunHeader
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

describe('findGitBash', () => {
  it('扫 ProgramFiles 下的 Git/bin/bash.exe', () => {
    const bash = join('C:\\Program Files', 'Git', 'bin', 'bash.exe')
    expect(
      findGitBash({ ProgramFiles: 'C:\\Program Files' }, (p) => p === bash)
    ).toBe(bash)
  })
  it('从 PATH 里的 git.exe 反推非默认安装根', () => {
    const gitCmd = join('X:\\Tools\\Git', 'cmd')
    const bash = join('X:\\Tools\\Git', 'bin', 'bash.exe')
    const present = new Set([join(gitCmd, 'git.exe'), bash])
    expect(findGitBash({ Path: gitCmd }, (p) => present.has(p))).toBe(bash)
  })
  it('PATH 上的 bash.exe 跳过 WSL 占位', () => {
    const wsl = join('C:\\Windows', 'System32', 'bash.exe')
    const real = join('X:\\Tools\\Git', 'usr', 'bin', 'bash.exe')
    const path = [join('C:\\Windows', 'System32'), join('X:\\Tools\\Git', 'usr', 'bin')].join(';')
    const present = new Set([wsl, real])
    expect(findGitBash({ Path: path }, (p) => present.has(p))).toBe(real)
  })
  it('不按冒号切开 Windows 盘符路径', () => {
    const gitCmd = join('E:\\Dev\\Git', 'cmd')
    const bash = join('E:\\Dev\\Git', 'bin', 'bash.exe')
    const present = new Set([join(gitCmd, 'git.exe'), bash])
    expect(findGitBash({ Path: gitCmd }, (p) => present.has(p))).toBe(bash)
  })
  it('找不到时返回 null', () => {
    expect(findGitBash({}, () => false)).toBeNull()
  })
})

describe('resolveWindowsShell', () => {
  it('git-bash 命中时用 bash 路径', () => {
    expect(resolveWindowsShell('git-bash', () => 'C:\\Git\\bin\\bash.exe')).toEqual({
      shell: 'git-bash',
      file: 'C:\\Git\\bin\\bash.exe'
    })
  })
  it('git-bash 未命中时回退 powershell', () => {
    expect(resolveWindowsShell('git-bash', () => null)).toEqual({
      shell: 'powershell',
      file: 'powershell.exe'
    })
  })
  it('显式 powershell / cmd', () => {
    expect(resolveWindowsShell('powershell', () => 'C:\\Git\\bin\\bash.exe').file).toBe(
      'powershell.exe'
    )
    expect(resolveWindowsShell('cmd', () => null).file).toBe('cmd.exe')
  })
})

describe('wrapWithRunHeader', () => {
  it('sh：printf 头再执行命令，并单引号转义', () => {
    const wrapped = wrapWithRunHeader("echo 'hi'", "/tmp/proj", 'sh')
    expect(wrapped.startsWith("printf '\\033[90m%s $\\033[0m \\033[1m%s\\033[0m\\n' ")).toBe(
      true
    )
    expect(wrapped).toContain("'/tmp/proj'")
    expect(wrapped).toContain("'echo '\\''hi'\\'''")
    expect(wrapped.endsWith("; echo 'hi'")).toBe(true)
  })
  it('powershell：Write-Host ANSI 头再执行命令', () => {
    const wrapped = wrapWithRunHeader('echo hi', 'C:\\p', 'powershell')
    expect(wrapped).toContain('Write-Host')
    expect(wrapped).toContain("'C:\\p'")
    expect(wrapped).toContain("'echo hi'")
    expect(wrapped.endsWith('; echo hi')).toBe(true)
  })
  it('cmd：echo 头再 & 执行命令', () => {
    expect(wrapWithRunHeader('dir', 'C:\\p', 'cmd')).toBe(
      `echo "\x1b[90mC:\\p $\x1b[0m \x1b[1mdir\x1b[0m"&dir`
    )
  })
})

describe('runHeaderShellFor', () => {
  it('posix 恒为 sh', () => {
    expect(runHeaderShellFor('darwin', 'powershell')).toBe('sh')
  })
  it('win32 跟随解析后的 shell', () => {
    expect(runHeaderShellFor('win32', 'cmd', () => null)).toBe('cmd')
    expect(runHeaderShellFor('win32', 'powershell', () => null)).toBe('powershell')
    expect(runHeaderShellFor('win32', 'git-bash', () => 'C:\\Git\\bin\\bash.exe')).toBe('sh')
    expect(runHeaderShellFor('win32', 'git-bash', () => null)).toBe('powershell')
  })
})

describe('buildShellInvocation', () => {
  it('posix 用登录交互 shell 执行，加载 PATH/nvm', () => {
    expect(
      buildShellInvocation('pnpm run dev', 'darwin', { posixShell: '/bin/zsh' })
    ).toEqual({
      file: '/bin/zsh',
      args: ['-l', '-i', '-c', 'pnpm run dev']
    })
  })
  it('无 $SHELL 时回退 /bin/zsh', () => {
    expect(buildShellInvocation('ls', 'linux', {}).file).toBe('/bin/zsh')
  })
  it('win32 默认 git-bash', () => {
    expect(
      buildShellInvocation('pnpm run dev', 'win32', {
        findGitBash: () => 'C:\\Git\\bin\\bash.exe'
      })
    ).toEqual({
      file: 'C:\\Git\\bin\\bash.exe',
      args: ['-l', '-i', '-c', 'pnpm run dev']
    })
  })
  it('win32 git-bash 未装时回退 powershell', () => {
    expect(
      buildShellInvocation('dir', 'win32', { findGitBash: () => null })
    ).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo', '-Command', 'dir']
    })
  })
  it('win32 显式 powershell / cmd', () => {
    expect(
      buildShellInvocation('echo hi', 'win32', { windowsShell: 'powershell' })
    ).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo', '-Command', 'echo hi']
    })
    expect(buildShellInvocation('echo hi', 'win32', { windowsShell: 'cmd' })).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', 'echo hi']
    })
  })
})

describe('buildShellSession', () => {
  it('posix 起登录交互 shell，不带 -c', () => {
    expect(buildShellSession('darwin', { posixShell: '/bin/zsh' })).toEqual({
      file: '/bin/zsh',
      args: ['-l', '-i']
    })
  })
  it('无 $SHELL 时回退 /bin/zsh', () => {
    expect(buildShellSession('linux', {}).file).toBe('/bin/zsh')
  })
  it('win32 默认 git-bash', () => {
    expect(
      buildShellSession('win32', { findGitBash: () => 'C:\\Git\\bin\\bash.exe' })
    ).toEqual({
      file: 'C:\\Git\\bin\\bash.exe',
      args: ['-l', '-i']
    })
  })
  it('win32 显式 powershell / cmd', () => {
    expect(buildShellSession('win32', { windowsShell: 'powershell' })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo']
    })
    expect(buildShellSession('win32', { windowsShell: 'cmd' })).toEqual({
      file: 'cmd.exe',
      args: []
    })
  })
})
