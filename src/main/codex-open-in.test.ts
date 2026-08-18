import { describe, expect, it } from 'vitest'
import {
  codexHandlerBlock,
  hasCodexHandler,
  removeCodexHandler,
  upsertCodexHandler,
  type CodexHandlerSpec
} from './codex-open-in'

const mac: CodexHandlerSpec = {
  id: 'devcube',
  label: 'DevCube',
  icon: '/Applications/DevCube.app/Contents/Resources/app.asar.unpacked/resources/icon.png',
  command: '/usr/bin/open',
  args: ['-b', 'com.wbbb.devcube']
}

const win: CodexHandlerSpec = {
  id: 'devcube-beta',
  label: 'DevCube Beta',
  icon: 'C:\\Users\\me\\AppData\\Local\\Programs\\devcube-beta\\resources\\icon.png',
  command: 'C:\\Users\\me\\AppData\\Local\\Programs\\devcube-beta\\DevCube Beta.exe'
}

describe('codexHandlerBlock', () => {
  it('icon 必填（当前桌面端缺失即整键丢弃）；mac 带 args；Windows 反斜杠转义合法', () => {
    expect(codexHandlerBlock(mac)).toBe(
      '[desktop.custom_file_handlers.devcube]\n' +
        'label = "DevCube"\n' +
        'icon = "/Applications/DevCube.app/Contents/Resources/app.asar.unpacked/resources/icon.png"\n' +
        'command = "/usr/bin/open"\n' +
        'args = ["-b", "com.wbbb.devcube"]\n'
    )
    expect(codexHandlerBlock(win)).toContain(
      'command = "C:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Programs\\\\devcube-beta\\\\DevCube Beta.exe"'
    )
  })
})

describe('upsertCodexHandler', () => {
  it('空文件 / 无文件直接写块', () => {
    const edit = upsertCodexHandler(null, mac)
    if (!edit.ok) throw new Error(edit.error)
    expect(edit.changed).toBe(true)
    expect(hasCodexHandler(edit.text, 'devcube')).toBe(true)
  })

  it('保留无关内容与注释，重复注册幂等', () => {
    const source = '# 我的配置\nmodel = "gpt-5.2"\n\n[mcp_servers.figma]\nurl = "http://x"\n'
    const first = upsertCodexHandler(source, mac)
    if (!first.ok) throw new Error(first.error)
    expect(first.text).toContain('# 我的配置')
    expect(first.text).toContain('[mcp_servers.figma]')
    const second = upsertCodexHandler(first.text, mac)
    if (!second.ok) throw new Error(second.error)
    expect(second.changed).toBe(false)
    expect(second.text).toBe(first.text)
  })

  it('已有旧块（后随其他表）时原位换新不重复', () => {
    const source =
      '[desktop.custom_file_handlers.devcube]\nlabel = "旧"\ncommand = "/old"\n\n[other]\nx = 1\n'
    const edit = upsertCodexHandler(source, mac)
    if (!edit.ok) throw new Error(edit.error)
    expect(edit.text).not.toContain('"旧"')
    expect(edit.text.match(/custom_file_handlers\.devcube/g)).toHaveLength(1)
    expect(edit.text).toContain('[other]')
  })

  it('原文件语法错误拒绝修改', () => {
    const edit = upsertCodexHandler('model = = broken', mac)
    expect(edit.ok).toBe(false)
  })

  it('与 inline table 定义冲突时拒绝并提示手动合并', () => {
    const source =
      '[desktop]\ncustom_file_handlers = { devcube = { label = "x", command = "y" } }\n'
    const edit = upsertCodexHandler(source, mac)
    expect(edit.ok).toBe(false)
  })
})

describe('removeCodexHandler', () => {
  it('移除自己的块并保留其余内容；不存在时不变', () => {
    const upserted = upsertCodexHandler('model = "gpt-5.2"\n', mac)
    if (!upserted.ok) throw new Error(upserted.error)
    const removed = removeCodexHandler(upserted.text, 'devcube')
    if (!removed.ok) throw new Error(removed.error)
    expect(removed.changed).toBe(true)
    expect(removed.text).toContain('model = "gpt-5.2"')
    expect(hasCodexHandler(removed.text, 'devcube')).toBe(false)

    const noop = removeCodexHandler('model = "gpt-5.2"\n', 'devcube')
    if (!noop.ok) throw new Error(noop.error)
    expect(noop.changed).toBe(false)
  })
})

describe('hasCodexHandler', () => {
  it('解析失败视为未注册', () => {
    expect(hasCodexHandler('model = = broken', 'devcube')).toBe(false)
    expect(hasCodexHandler(null, 'devcube')).toBe(false)
  })
})
