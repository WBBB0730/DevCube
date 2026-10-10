import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from '../shared/discover-source'
import {
  buildRemoteRunCommand,
  buildRemoteShellInDir,
  buildRemoteStatusCommand,
  buildScriptCommand,
  buildShellInvocation,
  buildShellSession,
  buildWslRunInvocation,
  buildWslShellSession,
  cwdFromPickedDir,
  findGitBash,
  findOnPath,
  resolveCwd,
  resolveDiscoveredCommand,
  resolveWindowsShell,
  resolveWslCwd,
  runHeaderShellFor,
  withTerminalLocale,
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
    expect(findGitBash({ ProgramFiles: 'C:\\Program Files' }, (p) => p === bash)).toBe(bash)
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

describe('buildRemoteStatusCommand', () => {
  it('整段脚本交给 sh -c，脚本里的单引号按 sh 规则转义', () => {
    expect(buildRemoteStatusCommand("echo 'a'\necho b")).toBe(`sh -c 'echo '\\''a'\\''\necho b'`)
  })
})

describe('buildRemoteRunCommand', () => {
  it('无工作目录：头里显示 ~，直接执行命令', () => {
    expect(buildRemoteRunCommand('tail -f app.log', undefined, undefined)).toBe(
      "printf '\\033[90m%s $\\033[0m \\033[1m%s\\033[0m\\n' '~' 'tail -f app.log'; tail -f app.log"
    )
  })

  it('工作目录与环境变量在命令前依次执行，任一步失败即停', () => {
    expect(buildRemoteRunCommand('npm start', '/srv/app', { NODE_ENV: 'production' })).toBe(
      "printf '\\033[90m%s $\\033[0m \\033[1m%s\\033[0m\\n' '/srv/app' 'npm start'; " +
        "cd '/srv/app' && export NODE_ENV='production' && npm start"
    )
  })

  it('~ 开头的目录保留波浪线展开，其余部分加引号；单引号转义', () => {
    expect(buildRemoteRunCommand('ls', '~/my app', { MSG: "it's" })).toContain(
      "cd ~/'my app' && export MSG='it'\\''s' && ls"
    )
    expect(buildRemoteRunCommand('ls', '~', undefined)).toContain('; cd ~ && ls')
  })
})

describe('buildRemoteShellInDir', () => {
  it('进目录后换成登录 shell，目录整体加引号', () => {
    expect(buildRemoteShellInDir("/srv/it's app")).toBe(
      `cd '/srv/it'\\''s app' && exec "$SHELL" -l`
    )
  })
})

describe('findOnPath', () => {
  it('按 PATH 顺序取第一个命中', () => {
    const brew = join('/opt/homebrew/bin', 'ssh')
    const system = join('/usr/bin', 'ssh')
    const present = new Set([brew, system])
    expect(
      findOnPath('ssh', { PATH: '/opt/homebrew/bin:/usr/bin' }, (p) => present.has(p), 'darwin')
    ).toBe(brew)
  })
  it('Windows 补 .exe 且按分号切 PATH', () => {
    const ssh = join('C:\\Windows\\System32\\OpenSSH', 'ssh.exe')
    expect(
      findOnPath('ssh', { Path: 'C:\\Windows\\System32\\OpenSSH;D:\\x' }, (p) => p === ssh, 'win32')
    ).toBe(ssh)
  })
  it('找不到时返回 null', () => {
    expect(findOnPath('ssh', { PATH: '/usr/bin' }, () => false, 'linux')).toBeNull()
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
    const wrapped = wrapWithRunHeader("echo 'hi'", '/tmp/proj', 'sh')
    expect(wrapped.startsWith("printf '\\033[90m%s $\\033[0m \\033[1m%s\\033[0m\\n' ")).toBe(true)
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
    expect(buildShellInvocation('pnpm run dev', 'darwin', { posixShell: '/bin/zsh' })).toEqual({
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
    expect(buildShellInvocation('dir', 'win32', { findGitBash: () => null })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo', '-Command', 'dir']
    })
  })
  it('win32 显式 powershell / cmd', () => {
    expect(buildShellInvocation('echo hi', 'win32', { windowsShell: 'powershell' })).toEqual({
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
    expect(buildShellSession('win32', { findGitBash: () => 'C:\\Git\\bin\\bash.exe' })).toEqual({
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

describe('withTerminalLocale', () => {
  it('没有 LANG（程序坞启动的 GUI 应用）→ 补 zh_CN.UTF-8', () => {
    expect(withTerminalLocale({ PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      LANG: 'zh_CN.UTF-8'
    })
  })

  it('LANG 不是 UTF-8 → 补 zh_CN.UTF-8', () => {
    expect(withTerminalLocale({ LANG: 'C' }).LANG).toBe('zh_CN.UTF-8')
    expect(withTerminalLocale({ LANG: 'en_US.ISO8859-1' }).LANG).toBe('zh_CN.UTF-8')
    expect(withTerminalLocale({ LANG: '' }).LANG).toBe('zh_CN.UTF-8')
  })

  it('LANG 已是 UTF-8 → 原样保留', () => {
    expect(withTerminalLocale({ LANG: 'en_US.UTF-8' }).LANG).toBe('en_US.UTF-8')
    expect(withTerminalLocale({ LANG: 'de_DE.utf8' }).LANG).toBe('de_DE.utf8')
    expect(withTerminalLocale({ LANG: 'ja_JP.eucJP' }).LANG).toBe('ja_JP.eucJP')
  })

  it('不改传入的环境对象', () => {
    const env = { PATH: '/usr/bin' }
    withTerminalLocale(env)
    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})

describe('resolveWslCwd', () => {
  const project = '\\\\wsl.localhost\\Ubuntu\\home\\me\\web'

  it('缺省为项目根（Linux 路径），相对路径按项目根解析', () => {
    expect(resolveWslCwd(project)).toBe('/home/me/web')
    expect(resolveWslCwd(project, 'packages\\api')).toBe('/home/me/web/packages/api')
    expect(resolveWslCwd(project, '../other')).toBe('/home/me/other')
  })

  it('同一发行版的 Windows 路径换成 Linux 路径；/、~ 开头原样用', () => {
    expect(resolveWslCwd(project, '\\\\wsl$\\ubuntu\\srv\\app')).toBe('/srv/app')
    expect(resolveWslCwd(project, '/opt/app')).toBe('/opt/app')
    expect(resolveWslCwd(project, '~/work')).toBe('~/work')
  })

  it('盘符路径与别的发行版原样交给 WSL 换算', () => {
    expect(resolveWslCwd(project, 'C:\\code\\web')).toBe('C:\\code\\web')
    expect(resolveWslCwd(project, '\\\\wsl.localhost\\Debian\\srv')).toBe(
      '\\\\wsl.localhost\\Debian\\srv'
    )
  })
})

describe('buildWslShellSession / buildWslRunInvocation', () => {
  const wslExe = 'C:\\Windows\\System32\\wsl.exe'

  it('终端：不带命令即登录 shell', () => {
    expect(buildWslShellSession(wslExe, 'Ubuntu', '/home/me/web')).toEqual({
      file: wslExe,
      args: ['-d', 'Ubuntu', '--cd', '/home/me/web']
    })
  })

  it('运行会话：经 launch 登记进程组、带上环境变量，再以登录 shell 执行', () => {
    expect(
      buildWslRunInvocation({
        wslExe,
        distro: 'Ubuntu',
        cwd: '/home/me/web',
        helper: '/mnt/c/DevCube/resources/wsl/devcube-wsl',
        runDir: '/tmp/devcube-wsl-runs-1',
        id: 'sid-1',
        shell: '/bin/zsh',
        command: 'pnpm dev',
        env: { PORT: '3000', NODE_OPTIONS: '--a=b c' }
      })
    ).toEqual({
      file: wslExe,
      args: [
        ...['-d', 'Ubuntu', '--cd', '/home/me/web'],
        ...['--exec', '/mnt/c/DevCube/resources/wsl/devcube-wsl', 'launch'],
        ...['--run-dir', '/tmp/devcube-wsl-runs-1', '--id', 'sid-1'],
        ...['--env', 'PORT=3000', '--env', 'NODE_OPTIONS=--a=b c', '--'],
        ...['/bin/zsh', '-l', '-i', '-c', 'pnpm dev']
      ]
    })
  })
})
