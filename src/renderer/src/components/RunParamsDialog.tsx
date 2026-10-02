// 命令型配置运行前的参数框（docs/prd/run-config-params.md）：配置里写了 `${{名称}}` 时，运行、重跑前先弹出，
// 每个参数一行（名称 + 等宽输入框，同 WHERE / ORDER BY 的「13px 等宽灰色标签 + 等宽输入」），预填这条配置上次用的值；
// 回车即运行，Esc 即取消。填的值按文字原样替换进内容，不加引号。
import { Fragment, useId, useState } from 'react'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { Input } from '@renderer/components/ui/input'
import type { RunParamsPrompt } from '@renderer/store'

export function RunParamsDialog({ prompt }: { prompt: RunParamsPrompt }): React.JSX.Element {
  const id = useId()
  const [values, setValues] = useState(() =>
    prompt.names.map((name) => (Object.hasOwn(prompt.initial, name) ? prompt.initial[name]! : ''))
  )

  const submit = (): void =>
    prompt.resolve(Object.fromEntries(prompt.names.map((name, i) => [name, values[i]!])))

  return (
    <FormDialogShell
      message={`填写 “${prompt.configName}” 的参数：`}
      buttons={[{ label: '运行', onClick: submit }]}
      onCancel={() => prompt.resolve(null)}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {prompt.names.map((name, i) => (
          <Fragment key={name}>
            <label
              htmlFor={`${id}-${i}`}
              title={name}
              className="max-w-40 truncate font-mono text-[13px] text-muted-foreground"
            >
              {name}
            </label>
            <Input
              id={`${id}-${i}`}
              value={values[i]}
              autoFocus={i === 0}
              spellCheck={false}
              className="font-mono"
              onChange={(e) =>
                setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
            />
          </Fragment>
        ))}
      </div>
    </FormDialogShell>
  )
}
