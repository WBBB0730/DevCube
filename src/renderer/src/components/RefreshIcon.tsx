// 刷新钮的图标：平时是刷新箭头，进行中换成转圈；两者叠在同一处以淡入淡出切换，不硬换。
// 转圈结束时先转回原位（useSpinUntilRest）再淡出——两者在原位的形状几乎重合，看起来是转圈停下化成箭头。
import { LoaderCircle, RotateCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

const LAYER = 'absolute size-4 transition-opacity duration-200'

export function RefreshIcon({
  spinning,
  onAnimationIteration
}: {
  /** useSpinUntilRest 的 spinning：从开始到转回原位的整段 */
  spinning: boolean
  onAnimationIteration: () => void
}): React.JSX.Element {
  return (
    <span className="relative flex size-4 items-center justify-center">
      <RotateCw className={cn(LAYER, spinning ? 'opacity-0' : 'opacity-100')} />
      <LoaderCircle
        className={cn(LAYER, spinning ? 'animate-spin opacity-100' : 'opacity-0')}
        onAnimationIteration={onAnimationIteration}
      />
    </span>
  )
}
