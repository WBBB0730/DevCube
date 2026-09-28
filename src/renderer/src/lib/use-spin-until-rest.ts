import { useCallback, useState } from 'react'

/**
 * 「进行中」图标的转动（如刷新钮）：active 期间一直转；active 结束后转完当前这一圈、停回原位才算停。
 * 靠 animationiteration：每转满一圈（角度回到 0°）看一次，这时正在原位，摘掉动画没有跳变。
 * spinning 覆盖从开始到停稳的整段，按钮在这段时间里保持进行中的样子（转圈图标、置灰、不可点），停稳才恢复；
 * 转回原位的途中 active 又变真，spinning 一直为真，动画不摘不重来，接着转。
 */
export function useSpinUntilRest(active: boolean): {
  spinning: boolean
  onAnimationIteration: () => void
} {
  const [spinning, setSpinning] = useState(active)
  if (active && !spinning) setSpinning(true)
  const onAnimationIteration = useCallback(() => {
    if (!active) setSpinning(false)
  }, [active])
  return { spinning, onAnimationIteration }
}
