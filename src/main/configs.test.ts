import { describe, expect, it } from 'vitest'
import { promote, reconcile } from './configs'
import type { RunConfig } from '../shared/types'

describe('promote', () => {
  it('首次运行的 script 被晋升为引用型配置', () => {
    const result = promote([], '/p', 'dev', 'id1')
    expect(result).toEqual([
      { id: 'id1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' }
    ])
  })

  it('已晋升过的 script 不重复追加', () => {
    const existing: RunConfig[] = [
      { id: 'id1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' }
    ]
    expect(promote(existing, '/p', 'dev', 'id2')).toBe(existing)
  })

  it('不同项目的同名 script 各自晋升', () => {
    const existing: RunConfig[] = [
      { id: 'id1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' }
    ]
    const result = promote(existing, '/other', 'dev', 'id2')
    expect(result).toHaveLength(2)
  })
})

describe('reconcile', () => {
  const scriptsByProject = new Map([['/p', new Set(['dev', 'build'])]])

  it('script 已消失的引用型配置被删除', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' },
      { id: '2', kind: 'referenced', projectPath: '/p', scriptName: 'gone' }
    ]
    expect(reconcile(configs, scriptsByProject).map((c) => c.id)).toEqual(['1'])
  })

  it('命令型配置永不被对账删除', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'command', projectPath: '/p', name: 'x', command: 'anything' }
    ]
    expect(reconcile(configs, scriptsByProject)).toEqual(configs)
  })

  it('项目未登记（无 scripts 集合）时保留其配置', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'referenced', projectPath: '/unknown', scriptName: 'dev' }
    ]
    expect(reconcile(configs, scriptsByProject)).toEqual(configs)
  })
})
