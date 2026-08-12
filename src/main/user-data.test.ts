import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configureUserData } from './user-data'

function expectConfiguredDirectory(input: {
  isPackaged: boolean
  version: string
  directory: string
}): void {
  const appData = mkdtempSync(join(tmpdir(), 'devcube-app-data-'))
  const setPath = vi.fn()

  try {
    configureUserData({
      isPackaged: input.isPackaged,
      getVersion: () => input.version,
      getPath: () => appData,
      setPath
    })

    const expected = join(appData, input.directory)
    expect(existsSync(expected)).toBe(true)
    expect(setPath).toHaveBeenCalledTimes(2)
    expect(setPath).toHaveBeenNthCalledWith(1, 'userData', expected)
    expect(setPath).toHaveBeenNthCalledWith(2, 'sessionData', expected)
  } finally {
    rmSync(appData, { recursive: true, force: true })
  }
}

describe('configureUserData', () => {
  it('Stable 显式使用现有 DevCube 数据目录', () => {
    expectConfiguredDirectory({
      isPackaged: true,
      version: '1.0.0',
      directory: 'DevCube'
    })
  })

  it('Beta 显式使用现有 DevCube Beta 数据目录', () => {
    expectConfiguredDirectory({
      isPackaged: true,
      version: '1.0.0-beta.1',
      directory: 'DevCube Beta'
    })
  })

  it('未包装运行使用独立的 DevCube Dev 数据目录', () => {
    expectConfiguredDirectory({
      isPackaged: false,
      version: '1.0.0',
      directory: 'DevCube Dev'
    })
  })
})
