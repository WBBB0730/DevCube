import { describe, expect, it } from 'vitest'
import {
  catalogConsoleContextChange,
  consoleContextChangeLevels,
  consoleContextFailureLevel,
  consoleContextKind,
  isCurrentConsoleContext,
  prependSearchPath,
  savedConsoleContext,
  searchPathItemName,
  searchPathItems
} from './data-source-context'

describe('consoleContextKind', () => {
  it('MySQL 与 MariaDB 同为 mysql；SQLite 没有', () => {
    expect(consoleContextKind('postgresql')).toBe('postgresql')
    expect(consoleContextKind('mysql')).toBe('mysql')
    expect(consoleContextKind('mariadb')).toBe('mysql')
    expect(consoleContextKind('redis')).toBe('redis')
    expect(consoleContextKind('sqlite')).toBeNull()
  })
})

describe('savedConsoleContext', () => {
  it('PostgreSQL 记库与 search_path，Redis 记库编号', () => {
    expect(
      savedConsoleContext({
        kind: 'postgresql',
        database: 'shop',
        schema: 'app',
        searchPath: 'app, public'
      })
    ).toEqual({ kind: 'postgresql', database: 'shop', searchPath: 'app, public' })
    expect(savedConsoleContext({ kind: 'redis', database: 3 })).toEqual({
      kind: 'redis',
      database: 3
    })
  })

  it('MySQL 选了库记库，没选库不记', () => {
    expect(savedConsoleContext({ kind: 'mysql', database: 'shop' })).toEqual({
      kind: 'mysql',
      database: 'shop'
    })
    expect(savedConsoleContext({ kind: 'mysql', database: null })).toBeNull()
  })
})

describe('searchPathItems', () => {
  it('按逗号切开、去掉空白，引号里的逗号不切', () => {
    expect(searchPathItems('"$user", public')).toEqual(['"$user"', 'public'])
    expect(searchPathItems('"a,b" ,  c')).toEqual(['"a,b"', 'c'])
    expect(searchPathItems('')).toEqual([])
  })
})

describe('searchPathItemName', () => {
  it('带引号的去引号并还原 ""，不带引号的折成小写', () => {
    expect(searchPathItemName('"$user"')).toBe('$user')
    expect(searchPathItemName('"My ""Schema"""')).toBe('My "Schema"')
    expect(searchPathItemName('Public')).toBe('public')
  })
})

describe('prependSearchPath', () => {
  it('选中的放到最前，原有各项原样跟在后面', () => {
    expect(prependSearchPath('"$user", public', 'app')).toBe('"app", "$user", public')
  })

  it('原来就有的那一项挪到最前，不重复', () => {
    expect(prependSearchPath('"$user", public, app', 'public')).toBe('"public", "$user", app')
    expect(prependSearchPath('"App", app', 'App')).toBe('"App", app')
  })

  it('模式名里的双引号加倍', () => {
    expect(prependSearchPath('public', 'a"b')).toBe('"a""b", public')
  })

  it('原来为空时只有选中的', () => {
    expect(prependSearchPath('', 'app')).toBe('"app"')
  })
})

describe('isCurrentConsoleContext', () => {
  const pg = {
    kind: 'postgresql' as const,
    database: 'shop',
    schema: 'public',
    searchPath: 'public'
  }

  it('PostgreSQL：同库且没选模式、或选的就是当前模式', () => {
    expect(isCurrentConsoleContext(pg, { kind: 'postgresql', database: 'shop' })).toBe(true)
    expect(
      isCurrentConsoleContext(pg, { kind: 'postgresql', database: 'shop', schema: 'public' })
    ).toBe(true)
    expect(
      isCurrentConsoleContext(pg, { kind: 'postgresql', database: 'shop', schema: 'app' })
    ).toBe(false)
    expect(isCurrentConsoleContext(pg, { kind: 'postgresql', database: 'crm' })).toBe(false)
  })

  it('MySQL 与 Redis 比库', () => {
    expect(
      isCurrentConsoleContext(
        { kind: 'mysql', database: 'shop' },
        { kind: 'mysql', database: 'shop' }
      )
    ).toBe(true)
    expect(
      isCurrentConsoleContext(
        { kind: 'mysql', database: null },
        { kind: 'mysql', database: 'shop' }
      )
    ).toBe(false)
    expect(
      isCurrentConsoleContext({ kind: 'redis', database: 1 }, { kind: 'redis', database: 1 })
    ).toBe(true)
    expect(
      isCurrentConsoleContext({ kind: 'redis', database: 1 }, { kind: 'redis', database: 2 })
    ).toBe(false)
  })
})

describe('consoleContextChangeLevels', () => {
  const pg = {
    kind: 'postgresql' as const,
    database: 'shop',
    schema: 'public',
    searchPath: 'public'
  }

  it('PostgreSQL 同库切模式只有模式要变，跨库切模式库与模式都变', () => {
    expect(
      consoleContextChangeLevels(pg, { kind: 'postgresql', database: 'shop', schema: 'app' })
    ).toEqual(['schema'])
    expect(
      consoleContextChangeLevels(pg, { kind: 'postgresql', database: 'billing', schema: 'app' })
    ).toEqual(['database', 'schema'])
  })

  it('不带模式只有库要变', () => {
    expect(consoleContextChangeLevels(pg, { kind: 'postgresql', database: 'billing' })).toEqual([
      'database'
    ])
    expect(
      consoleContextChangeLevels(
        { kind: 'mysql', database: 'shop' },
        { kind: 'mysql', database: 'billing' }
      )
    ).toEqual(['database'])
    expect(
      consoleContextChangeLevels({ kind: 'redis', database: 0 }, { kind: 'redis', database: 1 })
    ).toEqual(['database'])
  })

  it('控制台上下文还不知道时，带了模式也算库要变', () => {
    expect(
      consoleContextChangeLevels(undefined, { kind: 'postgresql', database: 'shop', schema: 'app' })
    ).toEqual(['database', 'schema'])
    expect(consoleContextChangeLevels(undefined, { kind: 'redis', database: 1 })).toEqual([
      'database'
    ])
  })
})

describe('consoleContextFailureLevel', () => {
  const pg = {
    kind: 'postgresql' as const,
    database: 'shop',
    schema: 'public',
    searchPath: 'public'
  }
  const crossSchema = { kind: 'postgresql' as const, database: 'billing', schema: 'app' }
  const sameSchema = { kind: 'postgresql' as const, database: 'shop', schema: 'app' }

  it('跨库切模式：连那个库出错为库，改 search_path 出错为模式', () => {
    expect(consoleContextFailureLevel(pg, crossSchema, { error: '连不上' })).toBe('database')
    expect(consoleContextFailureLevel(pg, crossSchema, { denied: true })).toBe('database')
    expect(consoleContextFailureLevel(pg, crossSchema, { error: '无效', searchPath: true })).toBe(
      'schema'
    )
    expect(consoleContextFailureLevel(pg, crossSchema, { denied: true, searchPath: true })).toBe(
      'schema'
    )
  })

  it('同库切模式一律为模式', () => {
    expect(consoleContextFailureLevel(pg, sameSchema, { error: '未连接' })).toBe('schema')
    expect(consoleContextFailureLevel(pg, sameSchema, { error: '无效', searchPath: true })).toBe(
      'schema'
    )
  })

  it('切库一律为库', () => {
    expect(
      consoleContextFailureLevel(pg, { kind: 'postgresql', database: 'billing' }, { denied: true })
    ).toBe('database')
    expect(
      consoleContextFailureLevel(
        { kind: 'mysql', database: 'shop' },
        { kind: 'mysql', database: 'billing' },
        { error: '没有这个库' }
      )
    ).toBe('database')
    expect(
      consoleContextFailureLevel(
        { kind: 'redis', database: 0 },
        { kind: 'redis', database: 99 },
        { error: '库编号超出范围' }
      )
    ).toBe('database')
  })
})

describe('catalogConsoleContextChange', () => {
  it('PostgreSQL：模式及其下的行换到那个库与模式，库及库下不属于模式的行只换库', () => {
    expect(catalogConsoleContextChange('postgresql', { database: 'shop', schema: 'app' })).toEqual({
      kind: 'postgresql',
      database: 'shop',
      schema: 'app'
    })
    expect(
      catalogConsoleContextChange('postgresql', {
        database: 'shop',
        schema: 'app',
        group: 'tables'
      })
    ).toEqual({ kind: 'postgresql', database: 'shop', schema: 'app' })
    expect(catalogConsoleContextChange('postgresql', { database: 'shop' })).toEqual({
      kind: 'postgresql',
      database: 'shop'
    })
    expect(
      catalogConsoleContextChange('postgresql', { database: 'shop', group: 'extensions' })
    ).toEqual({ kind: 'postgresql', database: 'shop' })
  })

  it('MySQL：库及其下的行换库', () => {
    expect(catalogConsoleContextChange('mysql', { database: 'shop' })).toEqual({
      kind: 'mysql',
      database: 'shop'
    })
    expect(catalogConsoleContextChange('mysql', { database: 'shop', group: 'tables' })).toEqual({
      kind: 'mysql',
      database: 'shop'
    })
  })

  it('根行与根下不属于某个库的行不换', () => {
    expect(catalogConsoleContextChange('postgresql', {})).toBeNull()
    expect(catalogConsoleContextChange('postgresql', { group: 'roles' })).toBeNull()
    expect(catalogConsoleContextChange('mysql', {})).toBeNull()
    expect(catalogConsoleContextChange('mysql', { group: 'users' })).toBeNull()
  })
})
