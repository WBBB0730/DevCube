import { describe, expect, it } from 'vitest'
import { parseLxssRegistry, wslPreflightReason, type WslPreflightFacts } from './wsl-preflight'

const REG_OUTPUT = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss',
  '    DefaultDistribution    REG_SZ    {aaaa}',
  '    DefaultVersion    REG_DWORD    0x2',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{aaaa}',
  '    State    REG_DWORD    0x1',
  '    DistributionName    REG_SZ    Ubuntu',
  '    Version    REG_DWORD    0x2',
  '    BasePath    REG_SZ    C:\\Users\\me\\AppData\\Local\\Packages\\Ubuntu\\LocalState',
  '    Flags    REG_DWORD    0xf',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{bbbb}',
  '    DistributionName    REG_SZ    Debian',
  '    Version    REG_DWORD    0x2',
  '    Flags    REG_DWORD    0x7',
  ''
].join('\r\n')

describe('parseLxssRegistry', () => {
  it('每个发行版子键取名字与 VM 模式位；根键不算发行版', () => {
    expect(parseLxssRegistry(REG_OUTPUT)).toEqual([
      { name: 'Ubuntu', wsl2: true },
      { name: 'Debian', wsl2: false }
    ])
  })

  it('空输出为空', () => {
    expect(parseLxssRegistry('')).toEqual([])
  })
})

describe('wslPreflightReason', () => {
  const ok: WslPreflightFacts = {
    storeWsl: true,
    distros: [{ name: 'Ubuntu', wsl2: true }],
    helperPresent: true
  }

  it('都满足时能连', () => {
    expect(wslPreflightReason('Ubuntu', ok)).toBeNull()
    expect(wslPreflightReason('ubuntu', ok)).toBeNull()
  })

  it('按顺序给出第一个原因', () => {
    expect(wslPreflightReason('Ubuntu', { ...ok, storeWsl: false, distros: [] })).toBe('未安装 WSL')
    expect(wslPreflightReason('Ubuntu', { ...ok, storeWsl: false })).toBe(
      'WSL 版本过旧，请运行 wsl --update 更新'
    )
    expect(wslPreflightReason('Debian', ok)).toBe('未找到发行版 Debian')
    expect(
      wslPreflightReason('Ubuntu', { ...ok, distros: [{ name: 'Ubuntu', wsl2: false }] })
    ).toBe('Ubuntu 是 WSL 1 发行版，请先运行 wsl --set-version Ubuntu 2 转换为 WSL 2')
    expect(wslPreflightReason('Ubuntu', { ...ok, helperPresent: false })).toBe(
      'DevCube 缺少 WSL 组件，请重新安装'
    )
  })
})
