import { describe, expect, it } from 'vitest'
import {
  OPEN_IN_APP_IDS,
  OPEN_IN_APP_LABELS,
  buildClaudeCodeNewSessionUrl,
  buildCodexNewThreadUrl,
  isOpenInAppId,
  unavailableReasonFor
} from './open-in-app'

describe('buildCodexNewThreadUrl', () => {
  it('编码绝对路径为官方 deep link', () => {
    expect(buildCodexNewThreadUrl('/Users/me/proj')).toBe(
      'codex://threads/new?path=%2FUsers%2Fme%2Fproj'
    )
  })

  it('编码 Windows 路径', () => {
    expect(buildCodexNewThreadUrl(String.raw`C:\Users\me\proj`)).toBe(
      'codex://threads/new?path=C%3A%5CUsers%5Cme%5Cproj'
    )
  })
})

describe('buildClaudeCodeNewSessionUrl', () => {
  it('编码绝对路径为官方 Desktop Code deep link', () => {
    expect(buildClaudeCodeNewSessionUrl('/Users/me/proj')).toBe(
      'claude://code/new?folder=%2FUsers%2Fme%2Fproj'
    )
  })
})

describe('open-in-app catalog', () => {
  it('三项按字母序且有中文不可用说明', () => {
    expect([...OPEN_IN_APP_IDS]).toEqual(['claude', 'codex', 'cursor'])
    expect(OPEN_IN_APP_LABELS.claude).toBe('Claude')
    expect(unavailableReasonFor('cursor')).toBe('未检测到 Cursor')
  })

  it('isOpenInAppId 校验', () => {
    expect(isOpenInAppId('cursor')).toBe(true)
    expect(isOpenInAppId('foo')).toBe(false)
  })
})
