import { describe, expect, it } from 'vitest'
import { passwordChangesOf, portError, portOfText, supportsDirectRoute } from './connection'

describe('passwordChangesOf', () => {
  it('添加：勾着才记下填的；测试用填的，没填即不用密码', () => {
    expect(passwordChangesOf('pw', true, false)).toEqual({ saved: 'pw', test: 'pw' })
    expect(passwordChangesOf('pw', false, false)).toEqual({ saved: undefined, test: 'pw' })
    expect(passwordChangesOf('', true, false)).toEqual({ saved: undefined, test: null })
    expect(passwordChangesOf('', false, false)).toEqual({ saved: undefined, test: null })
  })

  it('编辑：勾着时填了即换、没填沿用记住的；不勾即删掉，测试也不用记住的', () => {
    expect(passwordChangesOf('pw', true, true)).toEqual({ saved: 'pw', test: 'pw' })
    expect(passwordChangesOf('', true, true)).toEqual({ saved: undefined, test: undefined })
    expect(passwordChangesOf('pw', false, true)).toEqual({ saved: null, test: 'pw' })
    expect(passwordChangesOf('', false, true)).toEqual({ saved: null, test: null })
  })
})

describe('portOfText', () => {
  it('去掉首尾空白换成数字；没填为 NaN', () => {
    expect(portOfText(' 2222 ')).toBe(2222)
    expect(portOfText('')).toBeNaN()
    expect(portOfText('  ')).toBeNaN()
    expect(portOfText('22a')).toBeNaN()
  })
})

describe('portError', () => {
  it('1–65535 的整数可以提交，其余报错', () => {
    expect(portError(1)).toBeNull()
    expect(portError(65535)).toBeNull()
    expect(portError(0)).toBe('端口应为 1–65535 的整数')
    expect(portError(65536)).toBe('端口应为 1–65535 的整数')
    expect(portError(22.5)).toBe('端口应为 1–65535 的整数')
    expect(portError(Number.NaN)).toBe('端口应为 1–65535 的整数')
  })
})

describe('supportsDirectRoute', () => {
  it('只在 macOS / Windows 提供', () => {
    expect(supportsDirectRoute('darwin')).toBe(true)
    expect(supportsDirectRoute('win32')).toBe(true)
    expect(supportsDirectRoute('linux')).toBe(false)
  })
})
