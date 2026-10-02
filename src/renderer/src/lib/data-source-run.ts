// 数据源上的配置运行时要执行的各条（docs/prd/database.md「运行配置」）：在渲染端换好参数、切好，随运行交给主进程
// （见 DataSourceRunInput）。
import { allStatements } from '@renderer/lib/sql-statements'
import type { DataSourceKind } from '@shared/data-source'
import { redisCommandLines } from '@shared/redis'
import { fillRunParams, type RunParams } from '@shared/run-params'

/**
 * 先把参数按文字原样换成填的值，再切：SQL 按数据源的方言切出全部语句（同控制台的切法），Redis 一行一条命令。
 * 先换后切，填的值里有分号、换行时照样按换好的内容切。
 */
export function dataSourceRunStatements(
  kind: DataSourceKind,
  script: string,
  params: RunParams
): string[] {
  const filled = fillRunParams(script, params)
  return kind === 'redis' ? redisCommandLines(filled) : allStatements(filled, kind)
}
