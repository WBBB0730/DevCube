// 传输同名询问（docs/prd/server-files.md）：上传时服务器上、或下载文件夹时本机上已有同名文件，
// 选「替换」或「跳过」；一次传不止一个文件时可勾「对其余同名项同样处理」。
// 叠在别的弹窗上时 Esc 只作「跳过」这一次回答（捕获阶段先收下，同 SSH 提问弹窗）；点遮罩不收口；
// 答完把焦点还给打开前的地方。
import { useCallback, useState } from 'react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { useRestoreFocus } from '@renderer/lib/use-restore-focus'
import { useStackedEscape } from '@renderer/lib/use-stacked-escape'
import { useApp } from '@renderer/store'
import type { TransferConflictAction, TransferConflictRequest } from '@shared/server-files'

export function TransferConflictDialog({
  request
}: {
  request: TransferConflictRequest
}): React.JSX.Element {
  const answer = useApp((s) => s.answerTransferConflict)
  const [applyToRest, setApplyToRest] = useState(false)

  const respond = useCallback(
    (action: TransferConflictAction) =>
      answer({ id: request.id, action, applyToRest: request.batch && applyToRest }),
    [answer, request.id, request.batch, applyToRest]
  )
  const skip = useCallback(() => respond('skip'), [respond])
  useStackedEscape(skip)
  useRestoreFocus()

  const where =
    request.direction === 'upload' ? `服务器 ${request.serverName} 上` : '本机的目标文件夹里'
  return (
    <FormDialogShell
      message={`${where}已有同名文件 “${request.name}”。要替换它吗？`}
      buttons={[{ label: '替换', onClick: () => respond('replace') }]}
      cancelLabel="跳过"
      onCancel={() => respond('skip')}
      dismissible={false}
    >
      {request.batch && (
        <label className={CHOICE_ROW}>
          <Checkbox checked={applyToRest} onCheckedChange={setApplyToRest} />
          <span>对其余同名项同样处理</span>
        </label>
      )}
    </FormDialogShell>
  )
}
