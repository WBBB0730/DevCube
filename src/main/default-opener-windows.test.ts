import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FILES_OPEN_WITH_EXTS } from '../shared/files-kind'
import {
  openWithProgId,
  openWithRegFile,
  openWithUserChoiceQueryArgs,
  parseUserChoiceProgIds
} from './default-opener-windows'

describe('default-opener-windows', () => {
  it('ProgId 去空格并带类别', () => {
    expect(openWithProgId('DevCube Beta', 'image')).toBe('DevCubeBeta.image')
  })

  it('UserChoice 一次查全部扩展名', () => {
    expect(openWithUserChoiceQueryArgs()).toEqual([
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts',
      '/s',
      '/v',
      'ProgId'
    ])
  })

  it('解析批量查询输出：只认 UserChoice 键，扩展名转小写', () => {
    const key =
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts'
    const out = [
      '',
      `${key}\\.PNG\\UserChoice`,
      '    Hash    REG_SZ    abc==',
      '    ProgId    REG_SZ    DevCube.image',
      '',
      `${key}\\.pdf\\UserChoiceLatest`,
      '    ProgId    REG_SZ    MSEdgePDF',
      '',
      `${key}\\.md\\UserChoice`,
      '    ProgId    REG_SZ    DevCube.text',
      '',
      '搜索结束: 找到 3 匹配。',
      ''
    ].join('\r\n')
    const choices = parseUserChoiceProgIds(out)
    expect(choices.get('png')).toBe('DevCube.image')
    expect(choices.get('md')).toBe('DevCube.text')
    expect(choices.has('pdf')).toBe(false)
  })

  it('候选注册的 .reg 含 ProgId、OpenWithProgids、Capabilities 与 RegisteredApplications', () => {
    const reg = openWithRegFile('DevCube', ['C:\\App\\DevCube.exe'], {
      image: ['png'],
      text: ['md']
    })
    const lines = reg.split('\r\n')
    expect(lines[0]).toBe('Windows Registry Editor Version 5.00')
    expect(reg).toContain(
      '[HKEY_CURRENT_USER\\Software\\Classes\\DevCube.text\\shell\\open\\command]\r\n' +
        '@="\\"C:\\\\App\\\\DevCube.exe\\" \\"%1\\""'
    )
    expect(reg).toContain(
      '[HKEY_CURRENT_USER\\Software\\Classes\\.png\\OpenWithProgids]\r\n"DevCube.image"=hex(0):'
    )
    // 先删整键再写，旧版本多登记的扩展名不残留
    expect(reg).toContain(
      '[-HKEY_CURRENT_USER\\Software\\DevCube\\Capabilities\\FileAssociations]\r\n\r\n' +
        '[HKEY_CURRENT_USER\\Software\\DevCube\\Capabilities\\FileAssociations]\r\n' +
        '".png"="DevCube.image"\r\n".md"="DevCube.text"'
    )
    expect(reg).toContain(
      '[HKEY_CURRENT_USER\\Software\\RegisteredApplications]\r\n' +
        '"DevCube"="Software\\\\DevCube\\\\Capabilities"'
    )
  })

  it('Dev 身份的打开命令为 electron.exe + 项目入口 + %1', () => {
    const reg = openWithRegFile('DevCube Dev', ['C:\\e\\electron.exe', 'C:\\run'], {
      pdf: ['pdf']
    })
    expect(reg).toContain(
      '[HKEY_CURRENT_USER\\Software\\Classes\\DevCubeDev.pdf\\shell\\open\\command]\r\n' +
        '@="\\"C:\\\\e\\\\electron.exe\\" \\"C:\\\\run\\" \\"%1\\""'
    )
  })

  it('安装脚本卸载时清理的类别与「文件打开方式」类别一致', () => {
    const nsh = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8')
    const body = nsh.match(/!macro devcubeForEachOpenWithCategory[^\n]*\n([\s\S]*?)!macroend/)
    const categories = [...(body?.[1] ?? '').matchAll(/"\$\{ARG\}" "(\w+)"/g)].map((m) => m[1])
    expect(categories).toEqual(Object.keys(FILES_OPEN_WITH_EXTS))
  })
})
