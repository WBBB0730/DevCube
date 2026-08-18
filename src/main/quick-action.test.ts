import { describe, expect, it } from 'vitest'
import {
  quickActionDirName,
  quickActionDocumentWflow,
  quickActionInfoPlist,
  quickActionServiceKey,
  quickActionShellCommand
} from './quick-action'

describe('quick-action 生成器', () => {
  it('目录名与菜单文案随 productName（Edition 分线）', () => {
    expect(quickActionDirName('DevCube Beta')).toBe('在 DevCube Beta 中打开.workflow')
    expect(quickActionInfoPlist('在 DevCube 中打开')).toContain(
      '<string>在 DevCube 中打开</string>'
    )
  })

  it('pbs 启用位键名与系统设置手动启用产生的一致', () => {
    expect(quickActionServiceKey('DevCube Beta')).toBe(
      '(null) - 在 DevCube Beta 中打开 - runWorkflowAsService'
    )
  })

  it('服务只收 Finder 的 public.folder', () => {
    const plist = quickActionInfoPlist('在 DevCube 中打开')
    expect(plist).toContain('<string>public.folder</string>')
    expect(plist).toContain('<string>com.apple.finder</string>')
  })

  it('workflow 以参数形式把目录经 open(1) 转发（打包 -b / Dev -a，含空格路径安全）', () => {
    const wflow = quickActionDocumentWflow(quickActionShellCommand(['-b', 'com.wbbb.devcube']))
    expect(wflow).toContain(`<string>exec /usr/bin/open '-b' 'com.wbbb.devcube' "$@"</string>`)
    expect(wflow).toContain('<integer>1</integer>') // inputMethod = as arguments
    expect(wflow).toContain('<string>com.apple.Automator.servicesMenu</string>')

    expect(quickActionShellCommand(['-a', '/dev path/Electron.app'])).toBe(
      `exec /usr/bin/open '-a' '/dev path/Electron.app' "$@"`
    )
  })
})
