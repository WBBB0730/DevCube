// 内容搜索引擎集成测试：spawn 真实 rg 打临时 fixture 目录，验证事件流的外部行为。
// 这类 bug（stdin 非 TTY、收尾批次丢弃）只在真实 spawn 环境暴露，纯函数测试覆盖不到。
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CONTENT_SEARCH_MAX_MATCHES,
  DEFAULT_CONTENT_SEARCH_OPTIONS,
  type ContentSearchEvent,
  type ContentSearchMatch,
  type ContentSearchOptions
} from '../shared/content-search'
import { startContentSearch, stopContentSearch } from './content-search'

let root = ''
let seqCounter = 0

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'devcube-content-search-'))
  await writeFile(path.join(root, 'alpha.ts'), 'const a = 1\nconst needle = 2\n// needle again\n')
  await mkdir(path.join(root, 'sub'))
  await writeFile(path.join(root, 'sub', 'beta.md'), 'needle in doc\n')
  // IDE 忽略名：命中也不得出现在结果里
  await writeFile(path.join(root, '.DS_Store'), 'needle hidden\n')
  // 超过封顶数的语料（token 与 needle 无子串交集，避免污染其它用例）
  const big = Array.from({ length: CONTENT_SEARCH_MAX_MATCHES + 50 }, (_, i) => `${i} caphit`)
  await writeFile(path.join(root, 'big.txt'), big.join('\n') + '\n')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

afterEach(() => {
  stopContentSearch()
})

interface SearchResult {
  matches: ContentSearchMatch[]
  limitHit: boolean
  error: string | null
}

/** 启动一次搜索并等它跑到 done；乱序 / 旧 seq 事件直接失败。 */
function runSearch(
  query: string,
  options: ContentSearchOptions = DEFAULT_CONTENT_SEARCH_OPTIONS
): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    const seq = ++seqCounter
    const matches: ContentSearchMatch[] = []
    const timer = setTimeout(() => reject(new Error(`搜索 "${query}" 超时未完成`)), 4000)
    startContentSearch(root, query, options, seq, (e) => {
      if (e.seq !== seq) {
        clearTimeout(timer)
        reject(new Error(`收到非本次搜索的事件 seq=${e.seq}`))
        return
      }
      if (e.kind === 'matches') {
        matches.push(...e.matches)
      } else {
        clearTimeout(timer)
        resolve({ matches, limitHit: e.limitHit, error: e.error })
      }
    })
  })
}

describe('startContentSearch（真实 rg 进程）', () => {
  it('瞬时完成的搜索不丢任何结果（回归：收尾批次曾被 active 守卫丢弃）', async () => {
    const r = await runSearch('needle')
    expect(r.error).toBeNull()
    expect(r.limitHit).toBe(false)
    expect(r.matches.map((m) => `${m.rel}:${m.line}`).sort()).toEqual([
      'alpha.ts:2',
      'alpha.ts:3',
      'sub/beta.md:1'
    ])
    const first = r.matches.find((m) => m.rel === 'alpha.ts' && m.line === 2)
    expect(first?.text).toBe('const needle = 2')
    expect(first?.ranges).toEqual([[6, 12]])
  })

  it('IDE 忽略名（.DS_Store）不出现在结果里', async () => {
    const r = await runSearch('needle')
    expect(r.matches.some((m) => m.rel.includes('.DS_Store'))).toBe(false)
  })

  it('封顶即停：limitHit 标记且恰好封顶条数', async () => {
    const r = await runSearch('caphit')
    expect(r.limitHit).toBe(true)
    expect(r.matches).toHaveLength(CONTENT_SEARCH_MAX_MATCHES)
  })

  it('新搜索取代进行中的旧搜索，旧搜索不再发 done', async () => {
    const oldEvents: ContentSearchEvent[] = []
    startContentSearch(root, 'caphit', DEFAULT_CONTENT_SEARCH_OPTIONS, ++seqCounter, (e) =>
      oldEvents.push(e)
    )
    const r = await runSearch('needle')
    expect(r.matches).toHaveLength(3)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(oldEvents.every((e) => e.kind !== 'done')).toBe(true)
  })

  it('大小写与全词开关生效', async () => {
    const insensitive = await runSearch('NEEDLE')
    expect(insensitive.matches).toHaveLength(3)
    const sensitive = await runSearch('NEEDLE', {
      ...DEFAULT_CONTENT_SEARCH_OPTIONS,
      caseSensitive: true
    })
    expect(sensitive.matches).toHaveLength(0)
    const word = await runSearch('needle', { ...DEFAULT_CONTENT_SEARCH_OPTIONS, wholeWord: true })
    expect(word.matches.map((m) => m.rel).sort()).toEqual(['alpha.ts', 'alpha.ts', 'sub/beta.md'])
  })

  it('文件掩码收窄结果', async () => {
    const r = await runSearch('needle', { ...DEFAULT_CONTENT_SEARCH_OPTIONS, fileMask: '*.md' })
    expect(r.matches.map((m) => m.rel)).toEqual(['sub/beta.md'])
  })

  it('无匹配：done 无结果且无错误', async () => {
    const r = await runSearch('zzz_绝不存在')
    expect(r.matches).toHaveLength(0)
    expect(r.limitHit).toBe(false)
    expect(r.error).toBeNull()
  })

  it('正则无效：done 携带错误文案', async () => {
    const r = await runSearch('([bad', { ...DEFAULT_CONTENT_SEARCH_OPTIONS, regex: true })
    expect(r.matches).toHaveLength(0)
    expect(r.error).toContain('regex')
  })
})
