// 内容搜索（Content Search）：主进程 spawn rg --json，流式解析后按批推给渲染端。
// 单例语义——同一时刻至多一个搜索在跑，新搜索自动终止旧的；封顶即杀进程。
// gitignore / 隐藏文件 / IDE 忽略名口径与文件名索引一致（ADR-0027）。
// 本模块不直接用 electron（项目登记校验在 IPC 层做），可被集成测试直接驱动。

import { StringDecoder } from 'node:string_decoder'
import {
  buildRgSearchArgs,
  parseRgMatchLine,
  CONTENT_SEARCH_MAX_MATCHES,
  type ContentSearchEvent,
  type ContentSearchMatch,
  type ContentSearchOptions
} from '../shared/content-search'
import { isIdeIgnoredEntryName } from '../shared/files-tree-filter'
import { normalizePath } from '../shared/files-path'
import { runRg, type RgRun } from './rg'

const FLUSH_MS = 30

let current: { run: RgRun; seq: number } | null = null

export function stopContentSearch(): void {
  if (current) {
    current.run.kill()
    current = null
  }
}

/**
 * 启动搜索并流式回推事件；自动替换进行中的旧搜索。
 * 空查询由调用方短路；projectPath 须已由调用方（IPC 层）校验登记。
 */
export function startContentSearch(
  projectPath: string,
  query: string,
  options: ContentSearchOptions,
  seq: number,
  emit: (e: ContentSearchEvent) => void
): void {
  const root = normalizePath(projectPath)
  stopContentSearch()

  const active = (): boolean => current === mine

  let matchCount = 0
  let limitHit = false
  // 流式解码：多字节 UTF-8 字符可能被 chunk 边界劈开，直接 toString 会产生
  // 替换符并破坏该行 JSON；StringDecoder 缓存半个字符到下一 chunk
  const decoder = new StringDecoder('utf8')
  let stdoutRest = ''
  let stderrText = ''
  let batch: ContentSearchMatch[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // flush 本体不做存活判断：所有调用点（data/close/error 处理器入口）已用 active()
  // 守卫过；唯一异步触发的合批定时器在回调里自行守卫。若把判断写进 flush，
  // close 处理器中置空 current 后的收尾 flush 会把最后一批结果静默丢掉——
  // 搜索整体快于合批间隔时（小项目 / 精确查询）即表现为「永远无结果」。
  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (batch.length === 0) return
    emit({ kind: 'matches', seq, matches: batch })
    batch = []
  }

  const push = (m: ContentSearchMatch): void => {
    batch.push(m)
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        if (active()) flush()
      }, FLUSH_MS)
    }
  }

  const onStdout = (chunk: Buffer): void => {
    // 封顶 kill 后管道里可能还有已缓冲的 chunk，不再计入
    if (!active() || limitHit) return
    const lines = (stdoutRest + decoder.write(chunk)).split('\n')
    stdoutRest = lines.pop() ?? ''
    for (const line of lines) {
      const parsed = parseRgMatchLine(line)
      if (!parsed) continue
      // Windows 反斜杠归一 + 剥掉显式路径参数 `.` 带来的 `./` 前缀
      const rel = parsed.rel.split('\\').join('/').replace(/^\.\//, '')
      if (rel.split('/').some(isIdeIgnoredEntryName)) continue
      push({ ...parsed, rel })
      matchCount++
      if (matchCount >= CONTENT_SEARCH_MAX_MATCHES) {
        limitHit = true
        // 结束时统一 flush + done；kill 后剩余输出不再进来
        mine.run.kill()
        return
      }
    }
  }

  const mine = {
    run: runRg(root, buildRgSearchArgs(query, options), onStdout, (chunk) => {
      stderrText += chunk.toString('utf8')
    }),
    seq
  }
  current = mine

  void mine.run.done.then(({ code, error: spawnError }) => {
    if (!active()) return
    flush()
    current = null
    if (spawnError) {
      emit({ kind: 'done', seq, limitHit: false, error: spawnError.message })
      return
    }
    // 0 = 有匹配；1 = 无匹配；封顶主动 kill 后 code 为 null——都不算错。
    // 2 = rg 报错（如正则无效）：stderr 是「rg: 概述 + 缩进详情 + error: 原因」多行，
    // 取首尾两句拼成一行提示。
    let error: string | null = null
    if (!limitHit && code === 2) {
      const lines = stderrText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '' && !s.startsWith('^'))
        .map((s) => s.replace(/^(rg|error):\s*/, ''))
      const parts = lines.length > 1 ? [lines[0], lines[lines.length - 1]] : lines
      error = parts.join('：') || '搜索失败'
    }
    emit({ kind: 'done', seq, limitHit, error })
  })
}
