// react-resizable-panels 封装（vendored shadcn 风格，ADR-0053）：可拖分隔一律用它，不再手写拖拽。
// 面板与分隔线须是面板组的直接 DOM 子元素。分隔线 1px，默认 --separator（调用方可改色，沿用各处原边线）；
// 拖拽热区 6px 骑在线上（同 WebStorm OnePixelSplitter），拖拽中的光标由库统一接管。
// 库的热区只是几何判断：按在线旁的别的元素上（紧贴分隔线的滚动条、编辑器），按下先归它们处理，光标显示可拖却拖不动。
// 所以分隔线自己用 ::after 铺出同样大小的热区、盖在两侧之上，热区里的指针事件都落在分隔线上。层级 z-40：压过面板里的
// 各层（吸顶行、Git 的 diff 盖板等，最高到 40；同为 40 时分隔线在 DOM 里靠后，仍在上），低于整窗遮罩与弹层（z-50）。
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '@renderer/lib/utils'

/** 拖拽热区：鼠标 6px，触屏放宽到 20px（改动要同步分隔线 ::after 的外扩：(热区 - 1px) / 2） */
const HIT_TARGET = { coarse: 20, fine: 6 }

function ResizablePanelGroup(props: ResizablePrimitive.GroupProps): React.JSX.Element {
  return <ResizablePrimitive.Group resizeTargetMinimumSize={HIT_TARGET} {...props} />
}

function ResizablePanel(props: ResizablePrimitive.PanelProps): React.JSX.Element {
  return <ResizablePrimitive.Panel {...props} />
}

/** 分隔线：横排的面板组里是竖线（aria-orientation=vertical），竖排的是横线 */
function ResizableHandle({
  className,
  ...props
}: ResizablePrimitive.SeparatorProps): React.JSX.Element {
  return (
    <ResizablePrimitive.Separator
      className={cn(
        'relative z-40 shrink-0 bg-[var(--separator)] outline-none after:absolute',
        'aria-[orientation=vertical]:w-px aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-inset-x-[2.5px] pointer-coarse:aria-[orientation=vertical]:after:-inset-x-[9.5px]',
        'aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-inset-y-[2.5px] pointer-coarse:aria-[orientation=horizontal]:after:-inset-y-[9.5px]',
        className
      )}
      {...props}
    />
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
