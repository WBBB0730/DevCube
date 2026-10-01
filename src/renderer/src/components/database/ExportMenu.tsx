// 「导出」按钮与格式菜单（docs/prd/database.md「导出」）：选格式后先弹保存对话框（默认在下载目录），选好了才开始写文件。
// 结果不在界面上留文字：写文件时钮本身转圈并置灰（同「刷新」钮），写好了不提示，失败弹错误框给出原因。
// 「导出已取回的结果」（控制台、运行会话）见 ResultExportMenu。
import { useState } from 'react'
import { Download } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ErrorDialog } from '@renderer/components/ui/form-dialog'
import { BUSY_TRANSITION, BusyIcon, TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import { useSpinUntilRest } from '@renderer/lib/use-spin-until-rest'
import { cn } from '@renderer/lib/utils'
import type { SqlKind } from '@shared/data-source'
import {
  CONSOLE_EXPORT_TABLE,
  EXPORT_FORMAT_LABELS,
  EXPORT_FORMATS,
  type ExportFormat
} from '@shared/data-source-export'
import { queryFailureText, type ExportResult, type ResultSet } from '@shared/data-source-query'

export function ExportMenu({
  fileName,
  onExport
}: {
  /** 保存对话框里的默认文件名（不含扩展名，扩展名随格式） */
  fileName: string
  /** 保存位置选好后写文件；null 为没有可导出的（钮置灰） */
  onExport: ((format: ExportFormat, file: string) => Promise<ExportResult>) | null
}): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  // 导出失败的原因：弹错误框，点「确定」清掉
  const [error, setError] = useState<string | null>(null)
  // 转圈同「刷新」钮：结束后转回原位才换回导出图标、恢复可点（见 useSpinUntilRest）
  const spin = useSpinUntilRest(exporting)

  const run = async (
    format: ExportFormat,
    write: (format: ExportFormat, file: string) => Promise<ExportResult>
  ): Promise<void> => {
    const file = await window.api.pickDataSourceExportFile(fileName, format)
    if (file === null) return
    setExporting(true)
    const result = await write(format, file)
    setExporting(false)
    if (!('path' in result)) setError(queryFailureText(result))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="导出"
          className={cn(TOOLBAR_BTN, BUSY_TRANSITION)}
          disabled={onExport === null || spin.spinning}
        >
          <BusyIcon icon={Download} {...spin} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onExport !== null &&
            EXPORT_FORMATS.map((format) => (
              <DropdownMenuItem key={format} onClick={() => void run(format, onExport)}>
                {EXPORT_FORMAT_LABELS[format]}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error !== null && (
        <ErrorDialog title="导出失败" message={error} onClose={() => setError(null)} />
      )}
    </>
  )
}

/**
 * 「导出已取回的结果」（控制台、运行会话的操作栏共用）：导出已经取回的结果集，不为导出重新执行语句；还没有结果集（没执行、
 * 语句出错）时置灰。不知道来自哪张表，默认文件名与 SQL INSERT 的表名写成 CONSOLE_EXPORT_TABLE。
 */
export function ResultExportMenu({
  kind,
  result
}: {
  kind: SqlKind
  result: ResultSet | null
}): React.JSX.Element {
  return (
    <ExportMenu
      fileName={CONSOLE_EXPORT_TABLE}
      onExport={
        result === null
          ? null
          : (format, file) => window.api.exportDataSourceRows(kind, result, format, file)
      }
    />
  )
}
