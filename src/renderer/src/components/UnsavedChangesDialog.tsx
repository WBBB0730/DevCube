// 服务器上的文件未保存时的提示（docs/prd/server-files.md「会丢修改前先问」）：替换或关闭 Editor Tab、断开连接、
// 编辑或移除服务器前弹出。一次涉及多个文件时只问一次，正文逐行列出文件名。
// 「保存」为主按钮（Enter），「不保存」会丢掉修改：弱危险样式（同「断开连接」）、放在底栏左侧（同 macOS 的排布，免得误点），
// 「取消」/ Esc 即不继续。
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/ui/form-dialog'
import type { UnsavedChoice } from '@renderer/store'

export function UnsavedChangesDialog({
  names,
  onChoose
}: {
  /** 有未保存修改的文件名（至少一个） */
  names: readonly string[]
  onChoose: (choice: UnsavedChoice) => void
}): React.JSX.Element {
  const single = names.length === 1
  return (
    <ConfirmDialog
      title={single ? `保存对 “${names[0]}” 的修改？` : `保存对 ${names.length} 个文件的修改？`}
      message={
        single
          ? '修改还没有保存到服务器，不保存就会丢失。'
          : `修改还没有保存到服务器，不保存就会丢失。\n\n${names.join('\n')}`
      }
      buttons={[{ label: single ? '保存' : '全部保存', onClick: () => onChoose('save') }]}
      onCancel={() => onChoose('cancel')}
      footerStart={
        <Button variant="destructiveSoft" onClick={() => onChoose('discard')}>
          不保存
        </Button>
      }
    />
  )
}
