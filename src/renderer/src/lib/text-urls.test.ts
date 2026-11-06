import { describe, expect, it } from 'vitest'
import { findUrls } from './text-urls'

/** 认出的网址原文，按出现顺序 */
function urls(text: string): string[] {
  return findUrls(text).map(({ from, to }) => text.slice(from, to))
}

describe('findUrls', () => {
  it('给出网址在文字里的起止，按出现顺序', () => {
    expect(findUrls('见 https://a.com 与 http://b.com/x')).toEqual([
      { from: 2, to: 15 },
      { from: 18, to: 32 }
    ])
    expect(findUrls('没有网址')).toEqual([])
    expect(findUrls('')).toEqual([])
  })

  it.each([
    ["fetch('https://api.example.com/v1').then(r => r.json())", ['https://api.example.com/v1']],
    ['"url":"https://a.com"', ['https://a.com']],
    [
      '<a href="https://a.com/docs">https://a.com/docs</a>',
      ['https://a.com/docs', 'https://a.com/docs']
    ],
    ['<https://a.com/a>', ['https://a.com/a']],
    ['`https://a.com/x`', ['https://a.com/x']],
    ['[https://a.com](https://a.com)', ['https://a.com', 'https://a.com']],
    ['API_URL=https://api.example.com/v1', ['https://api.example.com/v1']]
  ])('代码与 Markdown 里的定界符不算进网址：%s', (text, expected) => {
    expect(urls(text)).toEqual(expected)
  })

  it.each([
    ['详见 https://a.com/a. 谢谢', ['https://a.com/a']],
    ['详见 https://a.com/a，谢谢', ['https://a.com/a']],
    ['见 https://en.wikipedia.org/wiki/Foo_(bar)。', ['https://en.wikipedia.org/wiki/Foo_(bar)']],
    ['(见 https://a.com/x)', ['https://a.com/x']],
    ['详见https://a.com/a', ['https://a.com/a']]
  ])('结尾标点（含中文）与不成对的括号截掉，中文紧挨着也认：%s', (text, expected) => {
    expect(urls(text)).toEqual(expected)
  })

  it('网址里的查询、锚点、端口、IPv6 与中文域名整段保留', () => {
    expect(urls('http://localhost:3000/p?q=1&r=https://b.com/c#frag')).toEqual([
      'http://localhost:3000/p?q=1&r=https://b.com/c#frag'
    ])
    expect(urls('http://[::1]:8080/x')).toEqual(['http://[::1]:8080/x'])
    expect(urls('https://例子.测试/路径')).toEqual(['https://例子.测试/路径'])
  })

  it('只认写全了协议的 http / https，不接在字母数字后面', () => {
    expect(urls('ftp://a.com mailto:a@b.c a@b.c example.com //cdn.com/x')).toEqual([])
    expect(urls('xhttps://a.com')).toEqual([])
    expect(urls('HTTPS://A.COM')).toEqual(['HTTPS://A.COM'])
  })
})
