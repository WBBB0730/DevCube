import { describe, expect, it } from 'vitest'
import {
  openWithCapabilitiesArgs,
  openWithProgId,
  openWithUserChoiceQueryArgs,
  parseRegQueryValue
} from './default-opener-windows'

describe('default-opener-windows', () => {
  it('ProgId 去空格并带类别', () => {
    expect(openWithProgId('DevCube Beta', 'image')).toBe('DevCubeBeta.image')
  })

  it('UserChoice 查询指向该扩展名的 ProgId 值', () => {
    expect(openWithUserChoiceQueryArgs('png')).toEqual([
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.png\\UserChoice',
      '/v',
      'ProgId'
    ])
  })

  it('解析 reg query 输出', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\...\\UserChoice',
      '    Hash    REG_SZ    abc==',
      '    ProgId    REG_SZ    DevCube.image',
      ''
    ].join('\r\n')
    expect(parseRegQueryValue(out, 'ProgId')).toBe('DevCube.image')
    expect(parseRegQueryValue(out, 'Nope')).toBeNull()
  })

  it('候选注册包含 Capabilities、RegisteredApplications 与各类 ProgId 及打开命令', () => {
    const args = openWithCapabilitiesArgs('DevCube', ['C:\\App\\DevCube.exe'], {
      image: ['png'],
      pdf: ['pdf']
    })
    const flat = args.map((a) => a.join(' '))
    expect(flat).toContain(
      'add HKCU\\Software\\RegisteredApplications /v DevCube /d Software\\DevCube\\Capabilities /f'
    )
    expect(flat).toContain(
      'add HKCU\\Software\\DevCube\\Capabilities\\FileAssociations /v .png /d DevCube.image /f'
    )
    expect(flat).toContain(
      'add HKCU\\Software\\DevCube\\Capabilities\\FileAssociations /v .pdf /d DevCube.pdf /f'
    )
    expect(flat).toContain(
      'add HKCU\\Software\\Classes\\DevCube.image\\shell\\open\\command /ve /d "C:\\App\\DevCube.exe" "%1" /f'
    )
  })

  it('Dev 身份的打开命令为 electron.exe + 项目入口 + %1', () => {
    const args = openWithCapabilitiesArgs('DevCube Dev', ['C:\\e\\electron.exe', 'C:\\run'], {
      pdf: ['pdf']
    })
    const flat = args.map((a) => a.join(' '))
    expect(flat).toContain(
      'add HKCU\\Software\\Classes\\DevCubeDev.pdf\\shell\\open\\command /ve /d "C:\\e\\electron.exe" "C:\\run" "%1" /f'
    )
  })
})
