// Files Tab 分页文档预览（PDF / PPT）共用的界面件：工具栏的页码与四档、缩略图开关（打不开时的占位见 FilesPreviewError）。
// 键盘 / 抓手 / 滚轮缩放在 lib/files-paged-preview，缩略图侧栏在 FilesPageThumbnails。
import { PanelLeft } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { MediaFitMode } from '@renderer/lib/files-media-zoom'
import { NumberInput } from '@renderer/components/ui/number-input'
import { TOOLBAR_BTN, TOOLBAR_SEPARATOR } from '@renderer/components/ui/toolbar'
import { MediaFitButtons } from './FilesMediaPreview'

/** 工具栏钮组最左一组：页码输入 / 总页数 · 竖线 · 四档（与看图共用同一组钮） */
export function FilesPageControls({
  page,
  pages,
  fitMode,
  onGoToPage,
  onFit
}: {
  page: number
  pages: number
  /** 当前所处的档；null = 滚轮缩出的自由倍率，四颗钮都不亮 */
  fitMode: MediaFitMode | null
  onGoToPage: (page: number) => void
  onFit: (mode: MediaFitMode) => void
}): React.JSX.Element {
  return (
    <>
      {/* 页码这组自己撑出与钮一致的左右留白（钮是 size-7 装 size-4 图标，等效 px-1.5），
          否则它紧贴面包屑与竖线，与右侧钮组的节奏对不上 */}
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <NumberInput
          value={page}
          title="页码"
          className="w-9"
          onCommit={(n) => onGoToPage(Math.min(pages, Math.max(1, Math.round(n))))}
        />
        <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">/ {pages}</span>
      </div>
      <div className={TOOLBAR_SEPARATOR} role="separator" />
      <MediaFitButtons active={fitMode} onFit={onFit} />
    </>
  )
}

/**
 * 缩略图侧栏开关：领在面包屑之前（侧栏在正文左侧，钮也靠左，位置不随路径长短漂移）；
 * 开着时点亮，激活态同四档钮 / 查找栏方形开关。
 */
export function FilesThumbnailsToggle({
  on,
  onToggle
}: {
  on: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title="缩略图"
      className={cn(
        TOOLBAR_BTN,
        on &&
          'bg-[var(--selection-row)] text-foreground hover:bg-[var(--selection-row)] hover:text-foreground'
      )}
      onClick={onToggle}
    >
      <PanelLeft className="size-4" />
    </button>
  )
}
