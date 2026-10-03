import { describe, expect, it } from 'vitest'
import {
  compressMenuAddArgs,
  compressMenuClsid,
  compressMenuDeleteArgs,
  compressMenuDllName,
  compressMenuKeys
} from './windows-compress-menu'

const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\devcube\\DevCube.exe'
const dll = 'C:\\Users\\me\\AppData\\Local\\devcube\\shell\\compress-menu-0123456789ab.dll'

describe('windows-compress-menu reg 参数', () => {
  it('各 Edition 各用一个 CLSID，动词键名随 ProductName', () => {
    const stable = compressMenuKeys({ productName: 'DevCube', name: 'devcube' })
    const beta = compressMenuKeys({ productName: 'DevCube Beta', name: 'devcube-beta' })
    expect(stable.fileVerb).toBe('HKCU\\Software\\Classes\\*\\shell\\DevCube.Compress')
    expect(beta.dirVerb).toBe('HKCU\\Software\\Classes\\Directory\\shell\\DevCube Beta.Compress')
    expect(stable.clsidKey).not.toBe(beta.clsidKey)
    expect(() => compressMenuClsid('other')).toThrow()
  })

  it('add：CLSID 指向 DLL 并带上文案 / 图标 / 唤起命令，两个动词经 ExplorerCommandHandler 指向它', () => {
    const identity = { productName: 'DevCube', name: 'devcube' }
    const clsid = compressMenuClsid('devcube')
    const args = compressMenuAddArgs(identity, dll, [exe])
    const flat = args.map((a) => a.join(' '))
    expect(flat).toContain(
      `add ${compressMenuKeys(identity).clsidKey}\\InprocServer32 /ve /d ${dll} /f`
    )
    expect(flat.some((a) => a.includes('/v Title /d 用 DevCube 压缩'))).toBe(true)
    expect(flat.some((a) => a.includes(`/v Command /d "${exe}"`))).toBe(true)
    expect(flat.filter((a) => a.includes(`/v ExplorerCommandHandler /d ${clsid}`))).toHaveLength(2)
    expect(flat.filter((a) => a.includes('/v MultiSelectModel /d Player'))).toHaveLength(2)

    const dev = compressMenuAddArgs({ productName: 'DevCube Dev', name: 'devcube-dev' }, dll, [
      'C:\\electron.exe',
      'C:\\proj'
    ])
    expect(dev.some((a) => a.includes('"C:\\electron.exe" "C:\\proj"'))).toBe(true)
  })

  it('delete：清掉两个动词键与 CLSID 键', () => {
    expect(compressMenuDeleteArgs({ productName: 'DevCube', name: 'devcube' })).toHaveLength(3)
  })

  it('DLL 文件名带内容指纹：内容不变名字不变', () => {
    const a = compressMenuDllName(Buffer.from('a'))
    expect(a).toMatch(/^compress-menu-[0-9a-f]{12}\.dll$/)
    expect(compressMenuDllName(Buffer.from('a'))).toBe(a)
    expect(compressMenuDllName(Buffer.from('b'))).not.toBe(a)
  })
})
