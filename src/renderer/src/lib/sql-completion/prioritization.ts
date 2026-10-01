// 使用频度：移植 pgcli/packages/prioritization.py（按执行过的语句统计名字与关键字出现的次数，补全时次数多的靠前）。
// pgcli 的关键字表只有一份，这里各方言各一份：计数时给出数据源的类型（关键字表与切词按它），同一个计数器可以跨方言共用
// （按数据源记，数据源改了类型也照旧）。pgcli 的次数只在内存里（启动时只从命令历史补回关键字），这里按数据源存盘、跨重启
// 保存（counts 取出、add 读回）。
import type { SqlKind } from '@shared/data-source'
import type { CompletionUsage } from '@shared/data-source-query'
import { completionDialect, type Dialect } from './dialects'
import { escapeRegex } from './parseutils/utils'
import { parseFresh } from './sqlparse/parse'
import { T, ttypeIn } from './sqlparse/tokens'

const keywordRegexes = new WeakMap<Dialect, [string, RegExp][]>()

/** prioritization.py: _compile_regex——关键字两端为词边界，中间的空白可为任意空白。 */
function compileRegex(keyword: string): RegExp {
  const escaped = escapeRegex(keyword).replace(/\s+/g, '\\s+')
  return new RegExp(`\\b${escaped}\\b`, 'gim')
}

function regexesOf(dialect: Dialect): [string, RegExp][] {
  let regexes = keywordRegexes.get(dialect)
  if (regexes === undefined) {
    regexes = dialect.keywords.map((kw) => [kw, compileRegex(kw)])
    keywordRegexes.set(dialect, regexes)
  }
  return regexes
}

/** 次数加进 counts。 */
function addCount(counts: Map<string, number>, key: string, count: number): void {
  counts.set(key, (counts.get(key) ?? 0) + count)
}

/** prioritization.py: PrevalenceCounter */
export class PrevalenceCounter {
  private readonly keywordCounts = new Map<string, number>()
  private readonly nameCounts = new Map<string, number>()

  /** prioritization.py: PrevalenceCounter.update */
  update(text: string, kind: SqlKind): void {
    this.updateKeywords(text, kind)
    this.updateNames(text, kind)
  }

  /** prioritization.py: PrevalenceCounter.update_names（执行过的语句只解析这一次，不进解析缓存） */
  updateNames(text: string, kind: SqlKind): void {
    for (const parsed of parseFresh(text, completionDialect(kind))) {
      for (const token of parsed.flatten()) {
        if (ttypeIn(token.ttype, T.Name)) addCount(this.nameCounts, token.value, 1)
      }
    }
  }

  /** prioritization.py: PrevalenceCounter.update_keywords（不靠 sqlparse，按关键字表逐个数） */
  updateKeywords(text: string, kind: SqlKind): void {
    for (const [keyword, regex] of regexesOf(completionDialect(kind))) {
      const count = text.match(regex)?.length ?? 0
      if (count > 0) addCount(this.keywordCounts, keyword, count)
    }
  }

  /** prioritization.py: PrevalenceCounter.keyword_count */
  keywordCount(keyword: string): number {
    return this.keywordCounts.get(keyword) ?? 0
  }

  /** prioritization.py: PrevalenceCounter.name_count */
  nameCount(name: string): number {
    return this.nameCounts.get(name) ?? 0
  }

  /** 眼下的各项次数（存盘用）。 */
  counts(): CompletionUsage {
    return {
      keywords: Object.fromEntries(this.keywordCounts),
      names: Object.fromEntries(this.nameCounts)
    }
  }

  /** 加上存下的次数（读回存盘的）。 */
  add(usage: CompletionUsage): void {
    for (const [keyword, count] of Object.entries(usage.keywords)) {
      addCount(this.keywordCounts, keyword, count)
    }
    for (const [name, count] of Object.entries(usage.names)) addCount(this.nameCounts, name, count)
  }
}
