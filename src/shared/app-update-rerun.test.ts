import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from './discover-source'
import type { ServerNode } from './server'
import type { ProjectNode } from './types'
import { rerunPrompt, runsToRerun } from './app-update-rerun'
import { scriptKey } from './runnable'

const tree: ProjectNode[] = [
  {
    project: { path: '/a', name: 'web', addedAt: 0, lastOpenedAt: null, pinned: false, order: 0 },
    packageManager: null,
    discovered: [],
    configs: [
      { id: 'r1', kind: 'referenced', projectPath: '/a', source: SCRIPT_SOURCE, scriptName: 'dev' },
      { id: 'c1', kind: 'command', projectPath: '/a', name: 'api', command: 'node api.js' }
    ],
    worktreeOf: null
  }
]

const servers: ServerNode[] = [
  {
    server: {
      id: 's',
      name: 'prod',
      target: { kind: 'config', alias: 'prod' },
      addedAt: 0,
      lastOpenedAt: null,
      pinned: false,
      order: 0,
      direct: false
    },
    hasPassword: false,
    configs: [{ id: 'm1', kind: 'remote', serverId: 's', name: 'logs', command: 'tail -f x' }]
  }
]

describe('runsToRerun', () => {
  it('按条目分组：Project 在前、Server 在后，组内按配置的顺序', () => {
    expect(runsToRerun(['m1', 'c1', 'r1'], tree, servers)).toEqual([
      {
        entryName: 'web',
        runs: [
          { id: 'r1', key: scriptKey('/a', SCRIPT_SOURCE, 'dev'), name: 'dev' },
          { id: 'c1', key: 'cmd\0c1', name: 'api' }
        ]
      },
      { entryName: 'prod', runs: [{ id: 'm1', key: 'cmd\0m1', name: 'logs' }] }
    ])
  })

  it('已删掉或不在 Project、Server 上的配置跳过，没有要跑的条目不出现', () => {
    expect(runsToRerun(['gone', 'c1', 'ds1'], tree, servers)).toEqual([
      { entryName: 'web', runs: [{ id: 'c1', key: 'cmd\0c1', name: 'api' }] }
    ])
  })
})

describe('rerunPrompt', () => {
  it('一条：标题点名，说明同多条', () => {
    expect(rerunPrompt(runsToRerun(['r1'], tree, servers))).toEqual({
      title: '重新运行 “dev”？',
      message: '以下配置更新前正在运行。\nweb：dev'
    })
  })

  it('多条：标题报数，说明里每个条目一行', () => {
    expect(rerunPrompt(runsToRerun(['r1', 'c1', 'm1'], tree, servers))).toEqual({
      title: '重新运行 3 个配置？',
      message: '以下配置更新前正在运行。\nweb：dev、api\nprod：logs'
    })
  })
})
