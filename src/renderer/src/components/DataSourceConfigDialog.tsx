// 数据源上的配置的新建 / 编辑（docs/prd/database.md）：名称、在哪个库上执行（SQLite 没有这一项）、内容——SQL 为整段语句，
// Redis 为一行一条命令。「库」可输入也可选：选项是表结构缓存里的库（连过这个数据源才有），留空即数据源的默认库。
// 编辑器同控制台（database/CodeEditor）；SQL 按方言高亮，补全同控制台交给补全引擎，表结构按「数据源 + 库」取（先取表结构
// 缓存，没有时借连着的 Data Source Tab 现查，都没有只补关键字、内置函数与类型），编辑框右上角的格式化钮同控制台（认得参数
// `${{…}}`）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { WandSparkles } from 'lucide-react'
import { ConfigDialogFrame, Field } from '@renderer/components/ConfigDialogFrame'
import { CodeEditor } from '@renderer/components/database/CodeEditor'
import { AutocompleteInput } from '@renderer/components/ui/autocomplete-input'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { useCompletionUsage } from '@renderer/lib/data-source-completion-usage'
import { useConfigCompletion } from '@renderer/lib/data-source-context'
import { formatSqlInEditor } from '@renderer/lib/data-source-sql'
import { paramAutoClose } from '@renderer/lib/run-param-autoclose'
import { sqlLanguage } from '@renderer/lib/sql-completion'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'
import {
  redisDatabaseError,
  type DataSourceNode,
  type NetworkDataSourceTarget
} from '@shared/data-source'
import { dataSourceEntryKey } from '@shared/tree-entry'
import type { DataSourceRunConfig } from '@shared/types'

export function DataSourceConfigDialog({
  ownerKey,
  config
}: {
  /** 所属条目：`datasource:<id>` */
  ownerKey: string
  config?: DataSourceRunConfig
}): React.JSX.Element | null {
  const node = useApp((s) =>
    s.dataSources.find((n) => dataSourceEntryKey(n.dataSource.id) === ownerKey)
  )
  if (node === undefined) return null
  return <DataSourceConfigForm node={node} config={config} />
}

function DataSourceConfigForm({
  node,
  config
}: {
  node: DataSourceNode
  config?: DataSourceRunConfig
}): React.JSX.Element {
  const close = useApp((s) => s.closeDialog)
  const save = useApp((s) => s.saveCommandConfig)
  const { id } = node.dataSource
  const target = node.dataSource.target
  const kind = target.kind
  const redis = kind === 'redis'

  const [name, setName] = useState(config?.name ?? '')
  const [script, setScript] = useState(config?.script ?? '')
  const [database, setDatabase] = useState(config?.database ?? '')
  // 格式化失败的原因：弹错误框，点「确定」清掉
  const [formatError, setFormatError] = useState<string | null>(null)
  // 「库」的选项：表结构缓存里的库（SQL 数据库才有，读到之前为空）
  const [databases, setDatabases] = useState<string[]>([])
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (kind === 'redis' || kind === 'sqlite') return
    let current = true
    void window.api.peekDataSourceDatabases(id).then((list) => {
      if (current) setDatabases(list)
    })
    return () => {
      current = false
    }
  }, [id, kind])

  const schema = useConfigCompletion(id, target, database.trim(), databases)
  const prioritizer = useCompletionUsage(redis ? null : id)

  // SQL 按方言高亮并补全（用得多的排前）；Redis 为纯文本。输入 `${{` 时补上 `}}`（两种都有）
  const extensions = useMemo(
    () => [
      paramAutoClose,
      kind === 'redis' ? [] : sqlLanguage(kind, { metadata: schema, prioritizer })
    ],
    [kind, schema, prioritizer]
  )

  const databaseError = redis ? redisDatabaseError(database.trim()) : null
  const valid = name.trim() !== '' && script.trim() !== '' && databaseError === null

  const submit = (): void => {
    if (!valid) return
    save(
      {
        kind: 'dataSource',
        dataSourceId: id,
        name: name.trim(),
        script: script.trim(),
        database: kind === 'sqlite' ? undefined : database.trim() || undefined
      },
      config?.id
    )
  }

  const format = (): void => {
    const view = viewRef.current
    if (view === null || kind === 'redis') return
    const failure = formatSqlInEditor(view, kind)
    if (failure !== null) setFormatError(failure)
  }

  return (
    <ConfigDialogFrame
      title={`${config ? '编辑' : '新建'} ${redis ? 'Redis' : 'SQL'} 配置`}
      className="w-[560px]"
      paramExample={redis ? 'GET user:${{id}}' : 'WHERE id = ${{id}}'}
      valid={valid}
      onClose={close}
      onSubmit={submit}
    >
      <Field label="名称">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="配置名称"
          autoFocus
        />
      </Field>
      {target.kind !== 'sqlite' && (
        <Field label={redis ? '库编号' : '库'}>
          <AutocompleteInput
            value={database}
            onChange={setDatabase}
            options={databases}
            placeholder={databasePlaceholder(target)}
            className="font-mono"
          />
          {databaseError !== null && (
            <div className="mt-1 text-[12px] text-[color:var(--status-failed)]">
              {databaseError}
            </div>
          )}
        </Field>
      )}
      <Field label={redis ? '命令' : 'SQL'}>
        <div className="relative h-56 overflow-hidden rounded-md border border-[var(--separator)]">
          <CodeEditor
            viewRef={viewRef}
            value={script}
            onChange={setScript}
            completion={!redis}
            extensions={extensions}
          />
          {/* 格式化钮浮在编辑框右上角：让开滚动条（8px）；铺编辑器底色，伸到下面的代码被它遮住而不与图标相叠 */}
          {!redis && (
            <button
              type="button"
              title="格式化"
              className={cn(TOOLBAR_BTN, 'absolute right-2.5 top-1 bg-deepest')}
              onClick={format}
            >
              <WandSparkles className="size-4" />
            </button>
          )}
        </div>
      </Field>
      {formatError !== null && (
        <ErrorDialog
          title="无法格式化"
          message={formatError}
          onClose={() => setFormatError(null)}
        />
      )}
    </ConfigDialogFrame>
  )
}

/** 库一栏的占位：留空时在哪个库上执行，只写默认值（数据源的默认库；Redis 为 0 号库）。没有默认库时不写。 */
function databasePlaceholder(target: NetworkDataSourceTarget): string {
  if (target.kind === 'redis') return target.database || '0'
  return target.database
}
