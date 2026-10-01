// 解析入口：移植 sqlparse/__init__.py: parse（词法换成 lang-sql 适配层，见 token-adapter.ts）。
import type { Dialect } from '../dialects'
import { LruCache } from '../lru'
import { tokenize } from '../token-adapter'
import { group } from './grouping'
import type { Statement } from './sql'
import { splitStatements } from './statement-splitter'

/**
 * sqlparse/__init__.py: parse——切成各条语句并分组，每次都得到新的一棵树。SqlStatement.parsed 用它：pgcli 的
 * get_previous_token 按对象同一性在这棵树里找记号，别处解析出的记号（如 find_prev_keyword 回退得到的）找不到。
 */
export function parseFresh(text: string, dialect: Dialect): Statement[] {
  return splitStatements(tokenize(text, dialect)).map(group)
}

/** 128 项（同 mycli），另限键的总字数 256K：够放下一条两万字的语句一次补全要解析的各段文字 */
const cache = new LruCache<Statement[]>(128, 256_000)

/**
 * 同 parseFresh，结果按（方言, 文字）缓存复用（mycli 的 _parse_suggestion_statement 同样用 lru_cache(maxsize=128)）：
 * 一次补全里同一段文字会被取表、子查询作用域、往回找关键字等多处解析。解析完成后树只读（分组只在 group 里做），
 * 所以可以共用。
 */
export function parse(text: string, dialect: Dialect): Statement[] {
  return cache.getOrCompute(`${dialect.kind}\u0000${text}`, () => parseFresh(text, dialect))
}
