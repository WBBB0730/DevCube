// 传输同名询问（docs/prd/server-files.md）：上传时服务器上、或下载文件夹时本机上已有同名文件，
// 选「替换」或「跳过」；一次传不止一个文件时可勾「对其余同名项同样处理」。
// 叠在别的弹窗上时 Esc 只作「跳过」这一次回答（捕获阶段先收下，同 SSH 提问弹窗）；点遮罩不收口。
import { useCallback, useEffect, useState } from 'react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      respond('skip')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [respond])

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
        <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-foreground">
          <Checkbox checked={applyToRest} onCheckedChange={setApplyToRest} />
          <span>对其余同名项同样处理</span>
        </label>
      )}
    </FormDialogShell>
  )
}
