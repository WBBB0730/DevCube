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
            pinned: false
          },
          packageManager: null,
          discovered: [],
          configs: [config]
        }
      ],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentProjectPath: '/a',
        selectedKey: key
      }
    })
    expect(slice.currentProjectPath).toBe('/a')
    expect(slice.selectedKey).toBe(`cmd${SEP}c1`)
    expect(slice.tree).toHaveLength(1)
  })

  it('工作台指向已删除项目时清空当前项', () => {
    const slice = workspaceSliceFromBootstrap({
      tree: [],
      sessions: [],
      terminals: [],
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS,
      workspace: {
        ...DEFAULT_WORKSPACE_UI,
        currentProjectPath: '/gone',
        selectedKey: `cmd${SEP}x`
      }
    })
    expect(slice.currentProjectPath).toBeNull()
    expect(slice.selectedKey).toBeNull()
  })
})
