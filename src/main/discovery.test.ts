import { describe, expect, it } from 'vitest'
import { SCRIPT_SOURCE } from '../shared/discover-source'
import type { RunConfig } from '../shared/types'
import {
  conventionEntries,
  discoverScripts,
  isFlutterPubspec,
  liveReferencedKeys,
  parseScripts,
  pickPackageManager,
  type ProjectFingerprints
} from './discovery'

const none: ProjectFingerprints = {
  hasGoMod: false,
  hasCargoToml: false,
  isFlutter: false,
  hasDotnet: false,
  hasCompose: false
}

describe('pickPackageManager', () => {
  it('按 pnpm > yarn > bun > npm 的优先级选取', () => {
    expect(pickPackageManager(['pnpm-lock.yaml', 'package-lock.json'])).toBe('pnpm')
    expect(pickPackageManager(['yarn.lock', 'package-lock.json'])).toBe('yarn')
    expect(pickPackageManager(['bun.lockb'])).toBe('bun')
    expect(pickPackageManager(['package-lock.json'])).toBe('npm')
  })

  it('没有任何 lockfile 时返回 null', () => {
    expect(pickPackageManager([])).toBeNull()
    expect(pickPackageManager(['README.md'])).toBeNull()
  })
})

describe('parseScripts', () => {
  it('取出 string 类型的 scripts', () => {
    expect(parseScripts('{"scripts":{"dev":"vite","build":"vite build"}}')).toEqual({
      dev: 'vite',
      build: 'vite build'
    })
  })

  it('忽略非 string 的 script 值', () => {
    expect(parseScripts('{"scripts":{"dev":"vite","x":123}}')).toEqual({ dev: 'vite' })
  })

  it('缺 scripts 或 JSON 损坏时返回空对象', () => {
    expect(parseScripts('{}')).toEqual({})
    expect(parseScripts('not json')).toEqual({})
    expect(parseScripts('{"scripts":null}')).toEqual({})
  })
})

describe('isFlutterPubspec', () => {
  it('识别 sdk: flutter', () => {
    expect(isFlutterPubspec('dependencies:\n  flutter:\n    sdk: flutter\n')).toBe(true)
  })

  it('纯 Dart pubspec 不命中', () => {
    expect(isFlutterPubspec('name: x\ndependencies:\n  http: any\n')).toBe(false)
  })
})

describe('conventionEntries', () => {
  it('未命中指纹时为空', () => {
    expect(conventionEntries(none)).toEqual([])
  })

  it('Go 指纹给出约定目录', () => {
    expect(conventionEntries({ ...none, hasGoMod: true })).toEqual([
      { source: 'go', name: 'run', command: 'go run .' },
      { source: 'go', name: 'test', command: 'go test ./...' },
      { source: 'go', name: 'build', command: 'go build' }
    ])
  })

  it('多指纹并存全部给出', () => {
    const entries = conventionEntries({ ...none, hasGoMod: true, hasCompose: true })
    expect(entries.map((e) => e.source)).toEqual(['go', 'go', 'go', 'compose', 'compose'])
  })

  it('Flutter / .NET / Compose / Cargo 约定目录', () => {
    expect(conventionEntries({ ...none, isFlutter: true }).map((e) => e.name)).toEqual([
      'run',
      'test',
      'analyze'
    ])
    expect(conventionEntries({ ...none, hasDotnet: true }).map((e) => e.command)).toEqual([
      'dotnet run',
      'dotnet test',
      'dotnet build'
    ])
    expect(conventionEntries({ ...none, hasCompose: true }).map((e) => e.name)).toEqual([
      'up',
      'up -d'
    ])
    expect(conventionEntries({ ...none, hasCargoToml: true })).toHaveLength(4)
  })
})

describe('discoverScripts', () => {
  const scripts = { dev: 'vite', build: 'vite build', test: 'vitest' }

  it('无配置时清单脚本全部是候补，并带 scripts 来源', () => {
    const result = discoverScripts('/p', scripts, none, [])
    expect(result.map((s) => s.name)).toEqual(['dev', 'build', 'test'])
    expect(result[0]).toEqual({
      projectPath: '/p',
      source: SCRIPT_SOURCE,
      name: 'dev',
      command: 'vite'
    })
  })

  it('剔除已晋升的同来源同名项', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    expect(discoverScripts('/p', scripts, none, configs).map((s) => s.name)).toEqual([
      'build',
      'test'
    ])
  })

  it('跨来源同名不互相剔除', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/p',
        source: SCRIPT_SOURCE,
        scriptName: 'test'
      }
    ]
    const result = discoverScripts('/p', scripts, { ...none, hasGoMod: true }, configs)
    expect(result.some((s) => s.source === 'go' && s.name === 'test')).toBe(true)
    expect(result.some((s) => s.source === SCRIPT_SOURCE && s.name === 'test')).toBe(false)
  })

  it('只按同项目去重，不误伤其它项目的同名 script', () => {
    const configs: RunConfig[] = [
      {
        id: '1',
        kind: 'referenced',
        projectPath: '/other',
        source: SCRIPT_SOURCE,
        scriptName: 'dev'
      }
    ]
    expect(discoverScripts('/p', scripts, none, configs).map((s) => s.name)).toContain('dev')
  })

  it('命令型配置不影响候补去重', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'command', projectPath: '/p', name: 'dev', command: 'echo hi' }
    ]
    expect(discoverScripts('/p', scripts, none, configs).map((s) => s.name)).toContain('dev')
  })

  it('约定命令接在清单脚本之后', () => {
    const result = discoverScripts('/p', { dev: 'vite' }, { ...none, hasGoMod: true }, [])
    expect(result.map((s) => `${s.source}:${s.name}`)).toEqual([
      'scripts:dev',
      'go:run',
      'go:test',
      'go:build'
    ])
  })
})

describe('liveReferencedKeys', () => {
  it('合并清单与约定存活键', () => {
    const keys = liveReferencedKeys({ dev: 'x' }, { ...none, hasGoMod: true })
    expect(keys).not.toBeNull()
    expect(keys!.has(`${SCRIPT_SOURCE}\0dev`)).toBe(true)
    expect(keys!.has('go\0test')).toBe(true)
  })

  it('快照不可用时返回 null', () => {
    expect(liveReferencedKeys(null, none)).toBeNull()
    expect(liveReferencedKeys({}, null)).toBeNull()
  })
})
