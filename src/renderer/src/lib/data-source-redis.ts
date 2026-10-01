// Redis 的 Data Source Tab（docs/prd/database.md「Redis」）：控制台的命令名补全（服务器的命令表，只补行首的命令名、
// 不补键名，与 SQL 的补全引擎无关）。
import { useEffect, useMemo, useState } from 'react'
import type { Completion, CompletionSource } from '@codemirror/autocomplete'
import { EditorState, type Extension } from '@codemirror/state'
import { redisCommandWordBefore } from '@shared/redis'

const NO_COMMANDS: readonly string[] = []

/** 命令名的补全源：光标在行首的第一个词里时列出命令名（交给 CodeMirror 自己筛选）；空着时只在按快捷键时列。 */
function commandCompletion(commands: readonly string[]): Extension {
  const options: Completion[] = commands.map((label) => ({ label, type: 'keyword' }))
  const source: CompletionSource = (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const target = redisCommandWordBefore(line.text.slice(0, context.pos - line.from))
    if (options.length === 0 || target === null || (target.word === '' && !context.explicit)) {
      return null
    }
    return { from: line.from + target.from, options, validFor: /^[\w.-]*$/ }
  }
  return EditorState.languageData.of(() => [{ autocomplete: source }])
}

/**
 * Redis 控制台的命令名补全（交给 ConsoleShell 的 language）：连上后向服务器取一次命令表，取回之前、
 * 取不到时不补。
 */
export function useRedisCommandCompletion(tabKey: string): Extension {
  const [loaded, setLoaded] = useState<{ tabKey: string; commands: string[] } | null>(null)
  useEffect(() => {
    let current = true
    void window.api.readRedisCommands(tabKey).then((result) => {
      if (current && Array.isArray(result)) setLoaded({ tabKey, commands: result })
    })
    return () => {
      current = false
    }
  }, [tabKey])
  const commands = loaded?.tabKey === tabKey ? loaded.commands : NO_COMMANDS
  // 引用保持不变：ConsoleShell 据它配置编辑器，变了编辑器要重新配置
  return useMemo(() => commandCompletion(commands), [commands])
}
