import { describe, expect, it } from 'vitest'
import { configKey } from './runnable'
import { workspaceSliceFromBootstrap } from './renderer-bootstrap'
import { DEFAULT_PROJECT_SORT_PREFS, type CommandRunConfig } from './types'
import { DEFAULT_WORKSPACE_UI } from './workspace'

const SEP = String.fromCharCode(0)

describe('workspaceSliceFromBootstrap', () => {
  it('恢复当前项目与选中配置', () => {
    const config: CommandRunConfig = {
      id: 'c1',
      kind: 'command',
      projectPath: '/a',
      name: 'dev',
      command: 'echo'
    }
    const key = configKey(config)
    const slice = workspaceSliceFromBootstrap({
      tree: [
        {
          project: {
            path: '/a',
            name: 'a',
            addedAt: 1,
            lastOpenedAt: 2,
            pinned: false,
            order: 0
          },
          packageManager: null,
          worktreeOf: null,
          discovered: [],
          configs: [config]
        }
      ],
      servers: [],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentEntryKey: '/a',
        selectedKey: key
      }
    })
    expect(slice.currentEntryKey).toBe('/a')
    expect(slice.selectedKey).toBe(`cmd${SEP}c1`)
    expect(slice.tree).toHaveLength(1)
  })

  it('恢复当前服务器', () => {
    const slice = workspaceSliceFromBootstrap({
      tree: [],
      servers: [
        {
          server: {
            id: 's1',
            name: 'prod',
            target: { kind: 'config', alias: 'prod' },
            addedAt: 1,
            lastOpenedAt: null,
            pinned: false,
            order: 0,
            direct: false
          },
          hasPassword: false,
          configs: []
        }
      ],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentEntryKey: 'server:s1',
        terminalsByEntry: { 'server:s1': [{ id: 'ssh:a', name: 'prod', serverId: 's1' }] }
      }
    })
    expect(slice.currentEntryKey).toBe('server:s1')
    expect(slice.terminals).toEqual([
      { key: 'ssh:a', ownerKey: 'server:s1', name: 'prod', serverId: 's1' }
    ])
  })

  it('恢复服务器下选中的配置', () => {
    const slice = workspaceSliceFromBootstrap({
      tree: [],
      servers: [
        {
          server: {
            id: 's1',
            name: 'prod',
            target: { kind: 'config', alias: 'prod' },
            addedAt: 1,
            lastOpenedAt: null,
            pinned: false,
            order: 0,
            direct: false
          },
          hasPassword: false,
          configs: [{ id: 'r1', kind: 'remote', serverId: 's1', name: 'logs', command: 'ls' }]
        }
      ],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentEntryKey: 'server:s1',
        selectedKey: `cmd${SEP}r1`
      }
    })
    expect(slice.selectedKey).toBe(`cmd${SEP}r1`)
  })

  it('工作台指向已删除项目时清空当前项', () => {
    const slice = workspaceSliceFromBootstrap({
      tree: [],
      servers: [],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentEntryKey: '/gone',
        selectedKey: `cmd${SEP}x`
      }
    })
    expect(slice.currentEntryKey).toBeNull()
    expect(slice.selectedKey).toBeNull()
  })
})
