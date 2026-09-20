import { describe, expect, it } from 'vitest'
import { isExternalLink } from './external-link'

describe('isExternalLink', () => {
  it('放行 http / https / mailto（协议不分大小写）', () => {
    expect(isExternalLink('https://example.com/a?b=1#c')).toBe(true)
    expect(isExternalLink('http://localhost:3000')).toBe(true)
    expect(isExternalLink('HTTPS://EXAMPLE.COM')).toBe(true)
    expect(isExternalLink('mailto:a@b.c')).toBe(true)
  })

  it('其他协议与相对地址一律拒绝', () => {
    expect(isExternalLink('file:///etc/passwd')).toBe(false)
    expect(isExternalLink('javascript:alert(1)')).toBe(false)
    expect(isExternalLink('devcube://open?path=/x')).toBe(false)
    expect(isExternalLink('ftp://example.com')).toBe(false)
    expect(isExternalLink('/docs/readme.md')).toBe(false)
    expect(isExternalLink('#anchor')).toBe(false)
    expect(isExternalLink('')).toBe(false)
  })
})
