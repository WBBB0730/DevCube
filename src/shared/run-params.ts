// 运行配置的参数（docs/prd/run-config-params.md，ADR-0048）：命令型配置里写成 `${{名称}}`、每次运行前填值的占位。
// 认参数与替换：渲染端问参数、数据源上的配置换好再切语句；主进程运行本机、服务器上的配置时换好再执行。

import type { CommandRunConfig, EditableRunConfig, RemoteRunConfig } from './types'

/** 运行配置的参数值：参数名 → 填的值。 */
export type RunParams = Record<string, string>

/** 参数两层花括号里的文字：不跨行、不含花括号。 */
const RUN_PARAM_BODY = '[^{}\\r\\n]*'

/**
 * 参数的写法 `${{…}}`（正则的源码，不带捕获组）：格式化 SQL 时据此把参数认作一个整体、原样保留（sql-formatter
 * 默认遇到它会报错）。与下面认参数的正则同源，两处不会各认各的。
 */
export const RUN_PARAM_SOURCE = `\\$\\{\\{${RUN_PARAM_BODY}\\}\\}`

/**
 * 参数：`${{名称}}`，名称为两层花括号里去掉首尾空白的文字（不跨行、不含花括号）。shell 读变量的 `${名称}`、SQL 的
 * `?` 与 `:名称` 都不算：bash、zsh、sh 遇到 `${{` 都报错，能正常运行的命令里不会有它。
 */
const RUN_PARAM = new RegExp(`\\$\\{\\{(${RUN_PARAM_BODY})\\}\\}`, 'g')

/** 参数名：两层花括号里去掉首尾空白；空的（`${{}}`、只有空白）不算参数，为 null。 */
function runParamName(inner: string): string | null {
  const name = inner.trim()
  return name === '' ? null : name
}

/** 几处文字里的参数名：写在哪里都算（含引号、注释里），去重，按第一次出现的顺序。 */
export function runParamNames(texts: readonly string[]): string[] {
  const names = new Set<string>()
  for (const text of texts) {
    for (const match of text.matchAll(RUN_PARAM)) {
      const name = runParamName(match[1]!)
      if (name !== null) names.add(name)
    }
  }
  return [...names]
}

/**
 * 配置里的参数名，按问的顺序：本机、服务器上的配置依次为命令、工作目录、各环境变量的值（环境变量名不认），数据源上的
 * 为内容；同名的只问一次。
 */
export function runConfigParamNames(config: EditableRunConfig): string[] {
  if (config.kind === 'dataSource') return runParamNames([config.script])
  return runParamNames([config.command, config.cwd ?? '', ...Object.values(config.env ?? {})])
}

/**
 * 把参数按文字原样换成填的值（不加引号、不转义）；没给值的参数与不算参数的原样留着。只换一遍，填的值里的 `${{…}}`
 * 不再展开。
 */
export function fillRunParams(text: string, params: RunParams): string {
  return text.replace(RUN_PARAM, (whole, inner: string) => {
    const name = runParamName(inner)
    return name !== null && Object.hasOwn(params, name) ? params[name]! : whole
  })
}

/** 本机、服务器上的配置换好参数：命令、工作目录与各环境变量的值，其余原样。 */
export function fillRunConfigParams<T extends CommandRunConfig | RemoteRunConfig>(
  config: T,
  params: RunParams
): T {
  return {
    ...config,
    command: fillRunParams(config.command, params),
    ...(config.cwd === undefined ? {} : { cwd: fillRunParams(config.cwd, params) }),
    ...(config.env === undefined
      ? {}
      : {
          env: Object.fromEntries(
            Object.entries(config.env).map(([key, value]) => [key, fillRunParams(value, params)])
          )
        })
  }
}
