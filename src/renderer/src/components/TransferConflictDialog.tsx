// 同名询问：选「替换」或「跳过」；一次处理不止一项时可勾「对其余同名项同样处理」。
// 两处用：传输（docs/prd/server-files.md：上传时服务器上、或下载文件夹时本机上已有同名文件）与
// 文件树的移动 / 复制（docs/prd/files-tree-move-copy.md「同名」）。
// 叠在别的弹窗上时 Esc 只作「跳过」这一次回答（同 SSH 提问弹窗）；点遮罩不收口。
import { useState } from 'react'
import { CHOICE_ROW, Checkbox } from '@renderer/components/ui/checkbox'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import { useApp } from '@renderer/store'
import type { TransferConflictAction, TransferConflictRequest } from '@shared/server-files'

export function SameNameDialog({
  message,
  batch,
  onAnswer
}: {
  message: string
  /** 不止一项：显示「对其余同名项同样处理」 */
  batch: boolean
  onAnswer: (action: TransferConflictAction, applyToRest: boolean) => void
}): React.JSX.Element {
  const [applyToRest, setApplyToRest] = useState(false)
  const respond = (action: TransferConflictAction): void => onAnswer(action, batch && applyToRest)
  return (
    <FormDialogShell
      message={message}
      buttons={[{ label: '替换', onClick: () => respond('replace') }]}
      cancelLabel="跳过"
      onCancel={() => respond('skip')}
    >
      {batch && (
        <label className={CHOICE_ROW}>
          <Checkbox checked={applyToRest} onCheckedChange={setApplyToRest} />
          <span>对其余同名项同样处理</span>
        </label>
      )}
    </FormDialogShell>
  )
}

export function TransferConflictDialog({
  request
}: {
  request: TransferConflictRequest
}): React.JSX.Element {
  const answer = useApp((s) => s.answerTransferConflict)
  const where =
    request.direction === 'upload' ? `服务器 ${request.serverName} 上` : '本机的目标文件夹里'
  return (
    <SameNameDialog
      message={`${where}已有同名文件 “${request.name}”。要替换它吗？`}
      batch={request.batch}
      onAnswer={(action, applyToRest) => answer({ id: request.id, action, applyToRest })}
    />
  )
}
