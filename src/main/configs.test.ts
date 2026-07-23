import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from '../shared/discover-source'
import type { RunConfig } from '../shared/types'
import { promote, reconcile } from './configs'

describe('promote', () => {
  it('首次运行的 script 被晋升为引用型配置（带来源）', () => {
    const result = promote([], '/p', SCRIPT_SOURCE, 'dev', 'id1')
    expect(result).toEqual([
      {
        id: 'id1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ])
  })

  it('已晋升过的同来源同名不重复追加', () => {
    const existing: RunConfig[] = [
      {
        id: 'id1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    expect(promote(existing, '/p', SCRIPT_SOURCE, 'dev', 'id2')).toBe(existing)
  })

  it('不同来源的同名各自晋升', () => {
    const existing: RunConfig[] = [
      {
        id: 'id1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'test'
      }
    ]
    const result = promote(existing, '/p', 'go', 'test', 'id2')
    expect(result).toHaveLength(2)
  })

  it('不同项目的同名 script 各自晋升', () => {
    const existing: RunConfig[] = [
      {
        id: 'id1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    const result = promote(existing, '/other', SCRIPT_SOURCE, 'dev', 'id2')
    expect(result).toHaveLength(2)
  })
})

describe('reconcile', () => {
  const aliveByProject = new Map<string, Set<string> | null>([
    ['/p', new Set([`${SCRIPT_SOURCE}\0dev`, `${SCRIPT_SOURCE}\0build`, 'go\0test'])]
  ])

  it('存活集合中已消失的引用型配置被删除', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      },
      {
        id: '2',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'gone'
      },
      { id: '3', kind: 'referenced', projectPath: '/p', source: 'go', scriptName: 'test' }
    ]
    expect(reconcile(configs, aliveByProject).map((c) => c.id)).toEqual(['1', '3'])
  })

  it('指纹消失时该来源约定引用被删，其它来源保留', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      },
      { id: '2', kind: 'referenced', projectPath: '/p', source: 'go', scriptName: 'test' }
    ]
    const onlyScripts = new Map<string, Set<string> | null>([
      ['/p', new Set([`${SCRIPT_SOURCE}\0dev`])]
    ])
    expect(reconcile(configs, onlyScripts).map((c) => c.id)).toEqual(['1'])
  })

  it('探测快照不可用（null）时保留引用型', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    const unread = new Map<string, Set<string> | null>([['/p', null]])
    expect(reconcile(configs, unread)).toEqual(configs)
  })

  it('命令型配置永不被对账删除', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'command', projectPath: '/p', name: 'x', command: 'anything' }
    ]
    expect(reconcile(configs, aliveByProject)).toEqual(configs)
  })

  it('项目未登记（无存活集合）时保留其配置', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/unknown',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    expect(reconcile(configs, aliveByProject)).toEqual(configs)
  })
})
