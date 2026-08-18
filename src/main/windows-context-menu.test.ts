import { describe, expect, it } from 'vitest'
import { contextMenuAddArgs, contextMenuDeleteArgs, contextMenuKeys } from './windows-context-menu'

const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\devcube\\DevCube.exe'

describe('windows-context-menu reg 参数', () => {
  it('键名随 ProductName（Edition 分线），覆盖文件夹与目录空白处', () => {
    const { dirKey, bgKey } = contextMenuKeys('DevCube Beta')
    expect(dirKey).toBe('HKCU\\Software\\Classes\\Directory\\shell\\DevCube Beta')
    expect(bgKey).toBe('HKCU\\Software\\Classes\\Directory\\Background\\shell\\DevCube Beta')
  })

  it('add：菜单文案 + Icon + command（各段带引号 + "%V"；Dev 多一段项目入口）', () => {
    const args = contextMenuAddArgs('DevCube', [exe])
    expect(args).toHaveLength(6)
    expect(args[0]).toContain('在 DevCube 中打开')
    expect(args.some((a) => a.includes('Icon') && a.includes(exe))).toBe(true)
    expect(args.some((a) => a.includes(`"${exe}" "%V"`))).toBe(true)

    const dev = contextMenuAddArgs('DevCube Dev', ['C:\\electron.exe', 'C:\\proj'])
    expect(dev.some((a) => a.includes('"C:\\electron.exe" "C:\\proj" "%V"'))).toBe(true)
  })

  it('delete：恰好清掉两个根键', () => {
    expect(contextMenuDeleteArgs('DevCube').map((a) => a[0])).toEqual(['delete', 'delete'])
  })
})
