// 滑杆（建在 Base UI Slider 上）：音视频操作栏的音量。
import { Slider as BaseSlider } from '@base-ui-components/react/slider'
import { cn } from '@renderer/lib/utils'

/** 横向滑杆：轨道高 4px、全圆角，已选段与 12px 圆形滑块同为图标色；命中区高 28px（同工具栏图标钮）。宽由调用方给。 */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  className
}: {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** 读屏用的名字 */
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      thumbAlignment="edge"
      className={cn('shrink-0', className)}
    >
      <BaseSlider.Control className="flex h-7 items-center">
        <BaseSlider.Track className="h-1 w-full rounded-full bg-[var(--progress-track)]">
          <BaseSlider.Indicator className="rounded-full bg-[var(--fg-icon)]" />
          <BaseSlider.Thumb
            aria-label={label}
            className="size-3 rounded-full bg-[var(--fg-icon)]"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
