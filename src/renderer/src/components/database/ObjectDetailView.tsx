// 「当前对象」为表与视图以外的对象时（docs/prd/database.md「当前对象」）：能取到建它的语句的显示定义（只读、语法高亮、可查找），
// 其余显示一张信息表（如角色的权限、序列的参数）。换对象时整个视图重建（调用方按对象给 key）。
// 每次打开都现查；读到前先显示表结构缓存里的（有的话），现查到了原地替换。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { CenteredHint, LoadingHint } from '@renderer/components/ui/centered-hint'
import { sqlLanguage } from '@renderer/lib/sql-completion'
import type { SqlKind } from '@shared/data-source'
import type { CatalogObject } from '@shared/data-source-catalog'
import { queryFailureText, type ObjectDetail } from '@shared/data-source-query'
import { CodeEditor } from './CodeEditor'
import { DataGrid } from './DataGrid'

export function ObjectDetailView({
  tabKey,
  kind,
  object
}: {
  tabKey: string
  kind: SqlKind
  object: CatalogObject
}): React.JSX.Element {
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [ref] = useState(object)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    let current = true
    // 现查已经到了，晚到的缓存就不用了
    void window.api
      .peekDataSourceObjectDetail(tabKey, ref.path, ref.name, ref.detail)
      .then((cached) => {
        if (current && cached !== null) setDetail((prev) => prev ?? cached)
      })
    void window.api
      .readDataSourceObjectDetail(tabKey, ref.path, ref.name, ref.detail)
      .then((result) => {
        if (current) setDetail(result)
      })
    return () => {
      current = false
    }
  }, [tabKey, ref])

  const language = useMemo(() => sqlLanguage(kind), [kind])

  if (detail === null) return <LoadingHint />
  if ('result' in detail)
    return <DataGrid columns={detail.result.columns} rows={detail.result.rows} />
  if ('definition' in detail) {
    return <CodeEditor viewRef={viewRef} value={detail.definition} readOnly extensions={language} />
  }
  return <CenteredHint error>{queryFailureText(detail)}</CenteredHint>
}
