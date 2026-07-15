import { describe, expect, it } from 'vitest'
import {
  configKey,
  filesTabKey,
  isFilesTabKey,
  isResidentTabKey,
  scriptKey
} from './runnable'
import type { RunConfig } from './types'

const SEP = String.fromCharCode(0)

describe('runnable keys', () => {
  it('引用型配置与同名探测脚本共享 key（保证晋升后单实例连续）', () => {
    const cfg: RunConfig = { id: '1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' }
    expect(configKey(cfg)).toBe(scriptKey('/p', 'dev'))
  })

  it('命令型配置按 id 生成独立 key', () => {
    const cfg: RunConfig = {
      id: 'abc',
      kind: 'command',
      projectPath: '/p',
      name: 'x',
      command: 'ls'
    }
    expect(configKey(cfg)).toBe(`cmd${SEP}abc`)
  })

  it('Files Tab 键与常驻判定', () => {
    expect(filesTabKey('/p')).toBe('files:/p')
    expect(isFilesTabKey('files:/p')).toBe(true)
    expect(isResidentTabKey('files:/p')).toBe(true)
    expect(isResidentTabKey('git:/p')).toBe(true)
    expect(isResidentTabKey('terminal:1')).toBe(false)
  })
})
