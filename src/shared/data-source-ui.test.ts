import { describe, expect, it } from 'vitest'
import {
  DATA_SOURCE_RECENT_MAX,
  dropRecentOpened,
  openedKey,
  openedLocation,
  pushRecentOpened,
  type DataSourceOpened
} from './data-source-ui'

const users: DataSourceOpened = {
  kind: 'object',
  path: { database: 'shop', schema: 'public', group: 'tables' },
  name: 'users'
}
const usersView: DataSourceOpened = { ...users, path: { ...users.path, group: 'views' } }
const fnInt: DataSourceOpened = {
  kind: 'object',
  path: { database: 'shop', schema: 'public', group: 'functions' },
  name: 'f',
  detail: '(integer)'
}
const fnText: DataSourceOpened = { ...fnInt, detail: '(text)' }
const key: DataSourceOpened = { kind: 'key', key: 'user:1' }

describe('openedKey', () => {
  it('对象按位置（含分组）、名称与说明区分；键按库编号与键名；对象与键不会撞上', () => {
    expect(openedKey(users)).toBe(openedKey({ ...users }))
    expect(openedKey(users)).not.toBe(openedKey(usersView))
    expect(openedKey(fnInt)).not.toBe(openedKey(fnText))
    expect(openedKey(key)).toBe(openedKey({ kind: 'key', key: 'user:1' }))
    expect(openedKey(key)).not.toBe(openedKey({ kind: 'key', key: 'user:2' }))
    expect(openedKey({ ...key, database: 1 })).toBe(openedKey({ ...key, database: 1 }))
    expect(openedKey({ ...key, database: 1 })).not.toBe(openedKey({ ...key, database: 2 }))
    expect(openedKey({ ...key, database: 0 })).not.toBe(openedKey(key))
  })
})

describe('pushRecentOpened', () => {
  it('放到最前，去掉同一个的旧项', () => {
    expect(pushRecentOpened([key, users, fnInt], { ...users })).toEqual([users, key, fnInt])
    expect(pushRecentOpened([], key)).toEqual([key])
  })

  it('同名而说明不同的函数、同名的表与视图各算一个', () => {
    expect(pushRecentOpened([fnInt, users], fnText)).toEqual([fnText, fnInt, users])
    expect(pushRecentOpened([users], usersView)).toEqual([usersView, users])
  })

  it(`最多留 ${DATA_SOURCE_RECENT_MAX} 个，挤掉最旧的`, () => {
    const keys: DataSourceOpened[] = Array.from({ length: DATA_SOURCE_RECENT_MAX }, (_, i) => ({
      kind: 'key',
      key: `k${i}`
    }))
    const next = pushRecentOpened(keys, key)
    expect(next).toHaveLength(DATA_SOURCE_RECENT_MAX)
    expect(next[0]).toEqual(key)
    expect(next.at(-1)).toEqual(keys.at(-2))
  })
})

describe('dropRecentOpened', () => {
  it('去掉同一个，其余顺序不变；没有它时原样', () => {
    expect(dropRecentOpened([key, users, fnInt], { ...users })).toEqual([key, fnInt])
    expect(dropRecentOpened([key, fnInt], fnText)).toEqual([key, fnInt])
  })
})

describe('openedLocation', () => {
  it('对象为「库.模式」，没有的省掉；键为所在的库，库编号未知时记下的为空', () => {
    expect(openedLocation(users)).toBe('shop.public')
    expect(
      openedLocation({ kind: 'object', path: { database: 'shop', group: 'tables' }, name: 't' })
    ).toBe('shop')
    expect(openedLocation({ kind: 'object', path: { group: 'tables' }, name: 't' })).toBe('')
    expect(openedLocation(key)).toBe('')
    expect(openedLocation({ ...key, database: 3 })).toBe('db3')
  })
})
