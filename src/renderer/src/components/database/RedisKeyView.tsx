// Redis 的「当前键」（docs/prd/database.md「Redis」）：顶栏是键名、类型与剩余过期时间；字符串显示原文——是对象或数组的
// JSON 时排版显示（只读编辑器，JSON 高亮、⌘F 查找，复制的即排版后的），哈希、列表、集合、有序集合与流显示成表（最多
// 1000 项）。换键时整个视图重建（调用方按键给 key），「刷新」重读。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { json } from '@codemirror/lang-json'
import type { EditorView } from '@codemirror/view'
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import { RefreshButton } from '@renderer/components/ui/toolbar'
import { useContentFocus } from '@renderer/lib/data-source-content-focus'
import { formatJsonText } from '@renderer/lib/json-format'
import { formatRedisTtl, REDIS_VALUE_LIMIT, type RedisKeyResult } from '@shared/redis'
import { CodeEditor } from './CodeEditor'
import { DataGrid } from './DataGrid'

const JSON_LANGUAGE = json()

export function RedisKeyView({
  tabKey,
  redisKey
}: {
  tabKey: string
  redisKey: string
}): React.JSX.Element {
  const [reload, setReload] = useState(0)
  // 结果连同它回答的请求一起存：刷新时旧结果照常显示，免得闪白
  const [result, setResult] = useState<{ reload: number; outcome: RedisKeyResult } | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    let current = true
    void window.api.readRedisKey(tabKey, redisKey).then((outcome) => {
      if (current) setResult({ reload, outcome })
    })
    return () => {
      current = false
    }
  }, [tabKey, redisKey, reload])

  const outcome = result?.outcome ?? null
  const detail = outcome !== null && 'type' in outcome ? outcome : null
  const loading = result?.reload !== reload
  const text = detail?.value.kind === 'text' ? detail.value.text : null
  // 字符串值是对象或数组的 JSON 时排好版的文字（不是则为 null，显示原文）
  const formattedJson = useMemo(() => (text === null ? null : formatJsonText(text)), [text])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--separator)] bg-panel pl-3 pr-2 text-[13px]">
        <span className="min-w-0 truncate font-mono text-[12px] text-foreground" title={redisKey}>
          {redisKey}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {detail !== null &&
            [
              detail.type,
              formatRedisTtl(detail.ttl),
              detail.value.kind === 'rows' && detail.value.truncated
                ? `只显示了前 ${REDIS_VALUE_LIMIT} 项`
                : null
            ]
              .filter((part) => part !== null)
              .join(' · ')}
        </span>
        <RefreshButton refreshing={loading} title="刷新" onClick={() => setReload((n) => n + 1)} />
      </div>
      <div className="relative min-h-0 flex-1">
        {outcome === null ? (
          <LoadingHint />
        ) : 'error' in outcome ? (
          <CenteredHint error>{outcome.error}</CenteredHint>
        ) : formattedJson !== null ? (
          <CodeEditor viewRef={viewRef} value={formattedJson} readOnly extensions={JSON_LANGUAGE} />
        ) : outcome.value.kind === 'text' ? (
          <TextValue text={outcome.value.text} />
        ) : outcome.value.kind === 'rows' ? (
          <DataGrid columns={outcome.value.result.columns} rows={outcome.value.result.rows} />
        ) : (
          <CenteredHint>不支持查看 {outcome.type} 类型的值</CenteredHint>
        )}
      </div>
    </div>
  )
}

/** 字符串的原文（不是对象或数组的 JSON 时）：可聚焦，在「当前键」一格里时是正文的焦点（同表格、只读编辑器）。 */
function TextValue({ text }: { text: string }): React.JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  const focusText = useCallback(() => ref.current?.focus({ preventScroll: true }), [])
  useContentFocus(focusText)
  return (
    <pre
      ref={ref}
      tabIndex={0}
      className="h-full select-text overflow-auto whitespace-pre-wrap break-all bg-deepest px-3 py-2 font-mono text-[12px] text-foreground outline-none"
    >
      {text}
    </pre>
  )
}
