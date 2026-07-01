import { describe, expect, it } from 'vitest'
import { discoverScripts, parseScripts, pickPackageManager } from './discovery'
import type { RunConfig } from '../shared/types'

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

describe('discoverScripts', () => {
  const scripts = { dev: 'vite', build: 'vite build', test: 'vitest' }

  it('无配置时全部 script 都是候补', () => {
    const result = discoverScripts('/p', scripts, [])
    expect(result.map((s) => s.name)).toEqual(['dev', 'build', 'test'])
    expect(result[0]).toEqual({ projectPath: '/p', name: 'dev', command: 'vite' })
  })

  it('剔除已晋升为引用型配置的同名 script', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'referenced', projectPath: '/p', scriptName: 'dev' }
    ]
    expect(discoverScripts('/p', scripts, configs).map((s) => s.name)).toEqual(['build', 'test'])
  })

  it('只按同项目去重，不误伤其它项目的同名 script', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'referenced', projectPath: '/other', scriptName: 'dev' }
    ]
    expect(discoverScripts('/p', scripts, configs).map((s) => s.name)).toContain('dev')
  })

  it('命令型配置不影响候补去重', () => {
    const configs: RunConfig[] = [
      { id: '1', kind: 'command', projectPath: '/p', name: 'dev', command: 'echo hi' }
    ]
    expect(discoverScripts('/p', scripts, configs).map((s) => s.name)).toContain('dev')
  })
})
