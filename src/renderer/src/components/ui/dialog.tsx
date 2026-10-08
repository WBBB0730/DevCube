// 弹窗外壳的单一定义源（Base UI Dialog，结构照 shadcn base-nova 的 dialog；ADR-0052）：遮罩 + 居中面板，
// 统一管关闭、焦点与「所在面板被隐藏」。小对话框族（ui/form-dialog）、设置弹层（SettingsModal）都建在它上面。
// - Esc = 取消：里面的控件已收下这次 Esc（preventDefault，如关补全、清空输入框）时不关；输入法合成中不关（Base UI 自带）。
// - 点遮罩默认不关（有文本输入的弹窗误触会丢内容），没有文本输入的弹窗用 dismissOnOutsidePress 打开；
//   按下或松开落在面板里的不算点遮罩（Base UI 自带，如拖选文字松在外面）。
// - dismissible=false：Esc 与遮罩都不关，只认明确的按钮（长任务进行中）。
// - 所在面板被隐藏（切走的 Tab）：弹窗收起、保留挂载（填的内容还在），收起期间不挡界面、不收键；切回来再显示。
// - 焦点锁在面板内；关掉后还给打开前的元素（焦点已被移到别处的不抢）。
// - 叠放：上层弹窗写在下层弹窗的子树里（Base UI 的嵌套对话框），Esc / 点遮罩只作用于最上层。
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog'
import { cn } from '@renderer/lib/utils'

/** 弹窗所在区域是否显示着：Tab 面板按自身可见性提供（见 Console）；不在面板里的恒为显示。 */
export const DialogHostVisibleContext = createContext(true)

/** 显示着的弹窗数（含叠放的；所在面板被隐藏而收起的不算） */
let shownCount = 0

/** 有弹窗显示着：应用快捷键与面板级的全局键盘一律让位。 */
export function isDialogOpen(): boolean {
  return shownCount > 0
}

export function Dialog({
  onClose,
  dismissible = true,
  dismissOnOutsidePress = false,
  initialFocus,
  className,
  onKeyDown,
  children
}: {
  /** 取消：Esc、点遮罩（dismissOnOutsidePress 时） */
  onClose: () => void
  /** false：Esc 与遮罩都不关 */
  dismissible?: boolean
  /** 点遮罩即取消（没有文本输入的弹窗） */
  dismissOnOutsidePress?: boolean
  /**
   * 打开时聚焦的元素（可顺带设好选区）；取不到时为面板本身——回车交给面板的 onKeyDown。
   * 已被 autoFocus 移进面板的不再改。
   */
  initialFocus?: () => HTMLElement | null
  /** 面板尺寸等（缺省 440px 宽，即小对话框族） */
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  children: React.ReactNode
}): React.JSX.Element {
  const visible = useContext(DialogHostVisibleContext)
  const popupRef = useRef<HTMLDivElement>(null)
  // 打开前的焦点：首次渲染时记下——此时面板还没挂上，autoFocus 还没把焦点移进来
  const [previousFocus] = useState(() => document.activeElement)

  useEffect(() => {
    if (!visible) return
    shownCount++
    return () => {
      shownCount--
    }
  }, [visible])

  return (
    <BaseDialog.Root
      open={visible}
      disablePointerDismissal={!dismissible || !dismissOnOutsidePress}
      onOpenChange={(open, details) => {
        if (open) return
        if (!dismissible || (details.reason === 'escape-key' && details.event.defaultPrevented)) {
          details.cancel()
          return
        }
        onClose()
      }}
    >
      <BaseDialog.Portal keepMounted>
        {/* 叠放的上层也画自己的遮罩（Base UI 默认不画嵌套对话框的遮罩） */}
        <BaseDialog.Backdrop forceRender className="fixed inset-0 z-50 bg-[color:var(--mask)]" />
        <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center">
          <BaseDialog.Popup
            ref={popupRef}
            initialFocus={() => initialFocus?.() ?? popupRef.current}
            finalFocus={() => {
              // 收起（所在面板被隐藏）不还焦点；焦点已被移到弹窗外的别处的不抢
              const active = document.activeElement
              const movedAway =
                active !== null && active !== document.body && !popupRef.current?.contains(active)
              if (!visible || movedAway) return false
              return previousFocus instanceof HTMLElement && previousFocus.isConnected
                ? previousFocus
                : false
            }}
            className={cn(
              'w-[440px] rounded-dialog border border-[color:var(--border-input)] bg-elevated shadow-xl outline-none',
              className
            )}
            onKeyDown={onKeyDown}
          >
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
