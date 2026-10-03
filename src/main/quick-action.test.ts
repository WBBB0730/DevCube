import { describe, expect, it } from 'vitest'
import {
  compressQuickActionShellCommand,
  quickActionDirName,
  quickActionDocumentWflow,
  quickActionInfoPlist,
  quickActionLabel,
  quickActionServiceKey,
  quickActionShellCommand
} from './quick-action'

describe('quick-action 生成器', () => {
  it('目录名与菜单文案随 productName（Edition 分线）', () => {
    expect(quickActionDirName('open', 'DevCube Beta')).toBe('在 DevCube Beta 中打开.workflow')
    expect(quickActionDirName('compress', 'DevCube')).toBe('用 DevCube 压缩.workflow')
    expect(quickActionInfoPlist('open', quickActionLabel('open', 'DevCube'))).toContain(
      '<string>在 DevCube 中打开</string>'
    )
  })

  it('pbs 启用位键名与系统设置手动启用产生的一致', () => {
    expect(quickActionServiceKey('open', 'DevCube Beta')).toBe(
      '(null) - 在 DevCube Beta 中打开 - runWorkflowAsService'
    )
    expect(quickActionServiceKey('compress', 'DevCube')).toBe(
      '(null) - 用 DevCube 压缩 - runWorkflowAsService'
    )
  })

  it('「打开」只收 Finder 的 public.folder，「压缩」收文件与文件夹', () => {
    const open = quickActionInfoPlist('open', '在 DevCube 中打开')
    expect(open).toContain('<string>public.folder</string>')
    expect(open).toContain('<string>com.apple.finder</string>')
    expect(quickActionInfoPlist('compress', '用 DevCube 压缩')).toContain(
      '<string>public.item</string>'
    )
    expect(quickActionDocumentWflow('compress', 'true')).toContain(
      '<string>com.apple.Automator.fileSystemObject</string>'
    )
    expect(quickActionDocumentWflow('compress', 'true')).not.toContain('fileSystemObject.folder')
  })

  it('workflow 以参数形式把目录经 open(1) 转发（打包 -b / Dev -a，含空格路径安全）', () => {
    const wflow = quickActionDocumentWflow(
      'open',
      quickActionShellCommand(['-b', 'com.wbbb.devcube'])
    )
    expect(wflow).toContain(`<string>exec /usr/bin/open '-b' 'com.wbbb.devcube' "$@"</string>`)
    expect(wflow).toContain('<integer>1</integer>') // inputMethod = as arguments
    expect(wflow).toContain('<string>com.apple.Automator.servicesMenu</string>')

    expect(quickActionShellCommand(['-a', '/dev path/Electron.app'])).toBe(
      `exec /usr/bin/open '-a' '/dev path/Electron.app' "$@"`
    )
  })

  it('「压缩」把全部选中项编进一个 deep link 交给应用', () => {
    const command = compressQuickActionShellCommand(['-b', 'com.wbbb.devcube'], 'devcube')
    expect(command).toContain(`/usr/bin/osascript -l JavaScript -e '`)
    expect(command).toContain('"devcube://compress?"')
    expect(command).toContain('encodeURIComponent(p)')
    expect(command).toMatch(/exec \/usr\/bin\/open -g '-b' 'com\.wbbb\.devcube' "\$url"$/)
    // 写进 workflow 时 & 与 < 等会被转义
    expect(quickActionDocumentWflow('compress', command)).toContain('.join("&amp;")')
  })
})
