// 服务器上的文件未保存时的提示（docs/prd/server-files.md）：切换文件、断开连接、编辑或移除服务器前弹出。
// 「保存」为主按钮（Enter），「不保存」会丢掉修改：弱危险样式（同「断开连接」）、放在底栏左侧（同 macOS 的排布，免得误点），
// 「取消」/ Esc 即不继续。
import { Button } from '@renderer/components/ui/button'
import { FormDialogShell } from '@renderer/components/ui/form-dialog'
import type { UnsavedChoice } from '@renderer/store'

export function UnsavedChangesDialog({
  name,
  onChoose
}: {
  name: string
  onChoose: (choice: UnsavedChoice) => void
}): React.JSX.Element {
  return (
    <FormDialogShell
      message={`“${name}” 有未保存的修改。要先保存到服务器吗？`}
      buttons={[{ label: '保存', onClick: () => onChoose('save') }]}
      onCancel={() => onChoose('cancel')}
      dismissOnOutsidePress
      footerStart={
        <Button variant="destructiveSoft" onClick={() => onChoose('discard')}>
          不保存
        </Button>
      }
    />
  )
}
