// 连上后的 Data Source Tab 的布局（SQL 数据库见 DataSourceView，Redis 见 RedisView；docs/prd/database.md、ADR-0043）：
// 右侧是树（目录 / 键列表）；左侧顶栏以工作表标签（同 Excel 预览底部，ui/sheet-tabs）在「当前对象 / 当前键」与「控制台」
// 两格间切换，两格各自保留内容——在树里点开别的只换左格，控制台不受影响。顶栏右端：登记的数据源有「最近打开」下拉
// （同 Files 工具栏的最近打开文件）；点开了对象 / 键、且停在「当前对象 / 当前键」那一格时再出定位钮（「在目录中显示」
// 「在键列表中显示」，同 Files 工具栏的「在文件树中显示」），切到「控制台」时收起。Tab 里不再分小 Tab。恢复上次打开的、
// 核对它还在不在时「当前对象 / 当前键」一格为加载中。当前显示那一格里的正文（表格、只读编辑器、字符串原文，控制台为
// 编辑器）在这里登记焦点（见 useDataSourceOpened）。
import { ListTree } from 'lucide-react'
import { LoadingHint } from '@renderer/components/ui/centered-hint'
import { SheetTabs } from '@renderer/components/ui/sheet-tabs'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import {
  ContentFocusContext,
  type ContentFocusRegister
} from '@renderer/lib/data-source-content-focus'
import type { DataSourceSlot } from '@shared/data-source-ui'

export function DataSourceLayout({
  slot,
  onSlotChange,
  currentLabel,
  recent,
  reveal,
  restoring,
  contentFocus,
  currentView,
  consoleView,
  tree
}: {
  slot: DataSourceSlot
  onSlotChange: (slot: DataSourceSlot) => void
  /** 左边那个标签的文字：点开的对象 / 键的名字，还没点开时为「当前对象」「当前键」 */
  currentLabel: string
  /** 顶栏右端的「最近打开」下拉（登记的数据源才给） */
  recent?: React.ReactNode
  /** 顶栏右端的定位钮（点开了对象 / 键时才给，只在「当前对象 / 当前键」那一格显示）：悬停说明与点击 */
  reveal?: { title: string; onClick: () => void }
  /** 正在核对上次打开的还在不在（恢复时）：「当前对象 / 当前键」一格显示加载中 */
  restoring: boolean
  /** 当前显示那一格里的正文登记焦点的地方 */
  contentFocus: ContentFocusRegister
  /** 「当前对象 / 当前键」一格；还没点开时为 null（空着） */
  currentView: React.ReactNode
  consoleView: React.ReactNode
  /** 右侧的树 */
  tree: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--separator)] bg-panel px-1.5">
          <SheetTabs
            className="min-w-0 flex-1 overflow-x-auto"
            value={slot}
            onValueChange={onSlotChange}
            items={[
              { value: 'current', label: currentLabel },
              { value: 'console', label: '控制台' }
            ]}
          />
          <div className="flex shrink-0 items-center gap-0.5">
            {recent}
            {reveal !== undefined && slot === 'current' && (
              <button
                type="button"
                title={reveal.title}
                className={TOOLBAR_BTN}
                onClick={reveal.onClick}
              >
                <ListTree className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <SlotPane shown={slot === 'current'} contentFocus={contentFocus}>
            {restoring ? <LoadingHint /> : currentView}
          </SlotPane>
          <SlotPane shown={slot === 'console'} contentFocus={contentFocus}>
            {consoleView}
          </SlotPane>
        </div>
      </div>
      {tree}
    </div>
  )
}

/** 左侧的一格：两格各自保留内容，只显示停着的那一格；也只有它里面的正文登记焦点。 */
function SlotPane({
  shown,
  contentFocus,
  children
}: {
  shown: boolean
  contentFocus: ContentFocusRegister
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={shown ? 'absolute inset-0' : 'hidden'}>
      <ContentFocusContext.Provider value={shown ? contentFocus : null}>
        {children}
      </ContentFocusContext.Provider>
    </div>
  )
}
