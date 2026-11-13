// Files Tab · 音视频预览：Chromium 原生 `<video>` / `<audio>` 控件（播不了的容器在打开分流时就占位，ADR-0010），
// 外加 B 站习惯的键盘操作（docs/prd/files-tab.md「音视频快捷键」）：空格播放 / 暂停，← / → 快退 / 快进 5 秒，
// 按住 → 2 倍速、松开恢复，F 全屏（仅视频），M 静音；↑ / ↓ 按树里可见顺序切上一个 / 下一个媒体。
// 守卫同看图：不抢输入框与弹层，焦点在文件树上时归树（空格除外），不要求焦点在播放器内。
// 调用方按文件给 key 重挂：换文件即换掉媒体元素，按住倍速等状态也不跨文件。
// 键盘监听挂在 layout effect 里：换文件是读完文件才提交的（不是交互触发），普通 effect 要等新画面画出来才挂上，
// 旧的又已随旧元素失效，这段空档里按下的空格会落到文件树、转进筛选框；layout effect 与新旧元素在同一次提交里交接。
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { FastForward } from 'lucide-react'
import { editableTarget, filesTreeTarget, overlayOpen } from '@renderer/lib/files-key-guards'

/** ← / → 一次快退 / 快进的秒数 */
const SEEK_STEP_S = 5
/** 按住 → 超过这么久转为倍速；不到就松开算一次快进 */
const HOLD_DELAY_MS = 300
/** 按住 → 时的倍速 */
const HOLD_RATE = 2

/** 开始播放：play() 被随后的 pause() 打断（如按住倍速很快松开）会以 AbortError 拒绝，属预期 */
function play(media: HTMLMediaElement): void {
  media.play().catch((err: unknown) => {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
  })
}

/** 快退 / 快进；越过结尾时浏览器的 seek 自会停在结尾 */
function seekBy(media: HTMLMediaElement, delta: number): void {
  media.currentTime = Math.max(media.currentTime + delta, 0)
}

export function FilesAvPreview({
  kind,
  src,
  mime,
  active,
  onPrev,
  onNext
}: {
  kind: 'audio' | 'video'
  src: string
  mime: string
  /** Files Tab 可见且为当前栏时才响应键盘 */
  active: boolean
  onPrev?: () => void
  onNext?: () => void
}): React.JSX.Element {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMedia = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
  }, [])
  /** 正按住 → 倍速播放（画面上出倍速标记） */
  const [holding, setHolding] = useState(false)

  // ↑ / ↓ 切上一个 / 下一个媒体（← / → 归快退快进）
  useLayoutEffect(() => {
    if (!active || (!onPrev && !onNext)) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (editableTarget(e.target) || filesTreeTarget(e.target) || overlayOpen()) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowUp') onPrev?.()
      else onNext?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, onPrev, onNext])

  // 播放键：空格、← / →（按住 → 倍速）、F、M。焦点在播放器上时也拦下，免得原生控件的键盘操作再动一次
  useLayoutEffect(() => {
    if (!active) return
    /** 按下 → 起算；到点即转倍速，并记下松开时要回到的倍速与暂停状态 */
    let hold: { timer: number; restore: { rate: number; paused: boolean } | null } | null = null
    /** 松开 → / 失焦 / 卸载：转了倍速的恢复原状，没转的按需算一次快进 */
    const endHold = (seekIfShort: boolean): void => {
      if (!hold) return
      window.clearTimeout(hold.timer)
      const media = mediaRef.current
      if (hold.restore) {
        if (media) {
          media.playbackRate = hold.restore.rate
          if (hold.restore.paused) media.pause()
        }
        setHolding(false)
      } else if (seekIfShort && media) {
        seekBy(media, SEEK_STEP_S)
      }
      hold = null
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const media = mediaRef.current
      if (!media) return
      const key = e.key.toLowerCase()
      const handled =
        key === ' ' ||
        key === 'arrowleft' ||
        key === 'arrowright' ||
        key === 'm' ||
        (key === 'f' && kind === 'video')
      if (!handled) return
      // 空格例外，焦点在文件树上也归播放：点树打开文件后焦点留在树上，而树顶筛选用不上空格
      if (editableTarget(e.target) || overlayOpen()) return
      if (key !== ' ' && filesTreeTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (key === 'arrowleft') {
        // 按住即连续快退（随按键重复）
        seekBy(media, -SEEK_STEP_S)
        return
      }
      // 其余键按住时的重复事件只拦不响应
      if (e.repeat) return
      if (key === ' ') {
        if (media.paused) play(media)
        else media.pause()
      } else if (key === 'arrowright') {
        if (hold) return
        hold = {
          timer: window.setTimeout(() => {
            if (!hold) return
            // 暂停中按住也照样倍速播放，松开回到暂停
            hold.restore = { rate: media.playbackRate, paused: media.paused }
            media.playbackRate = HOLD_RATE
            if (media.paused) play(media)
            setHolding(true)
          }, HOLD_DELAY_MS),
          restore: null
        }
      } else if (key === 'm') {
        media.muted = !media.muted
      } else if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void media.requestFullscreen()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') endHold(true)
    }
    const onBlur = (): void => endHold(false)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      endHold(false)
    }
  }, [active, kind])

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {kind === 'video' ? (
        <video ref={setMedia} controls preload="metadata" className="max-h-full max-w-full">
          <source src={src} type={mime} />
        </video>
      ) : (
        <audio ref={setMedia} controls preload="metadata">
          <source src={src} type={mime} />
        </audio>
      )}
      {holding && (
        <div className="pointer-events-none absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[color:var(--border-input)] bg-elevated px-2 py-1 text-[13px] text-foreground shadow-xl">
          <FastForward className="size-3.5" />
          {HOLD_RATE}×
        </div>
      )}
    </div>
  )
}
