// Files Tab · 音视频预览（播不了的容器在打开分流时就占位，ADR-0010）：音视频共用一行自绘的操作栏（播放、时间、倍速、
// 循环、音量）。音频上面是波形，波形即进度条（wavesurfer.js，ADR-0064）；视频的操作栏与进度条叠在画面底部，
// 控件显隐、全屏整个播放器与点按手势用 Video.js（ADR-0065）。
// 两者共用 B 站习惯的键盘操作（docs/prd/files-tab.md「音视频快捷键」）：空格播放 / 暂停，← / → 快退 / 快进 5 秒，
// 播放中按住 ← 连续快退、按住 → 2 倍速；暂停时按住不进入播放：音频连续快退 / 快进，视频改为逐帧（轻按退 / 进一帧，
// 按住连续退 / 进帧）。F 全屏（仅视频），M 静音。换文件用 ↑ / ↓，归文件树。
// 播放键两边一样（docs/prd/files-tab.md「按键归属」）：焦点在文件树、播放器、按钮上还是哪儿都不在都接，只让给输入框
// 与弹层；焦点在文件树的文件夹行上时 ← / → 归文件树开合。
// 调用方按文件给 key 重挂：换文件即换掉媒体元素，按住倍速等状态也不跨文件。
// 键盘监听挂在 layout effect 里：换文件是读完文件才提交的（不是交互触发），普通 effect 要等新画面画出来才挂上，
// 旧的又已随旧元素失效，这段空档里按下的空格没人接；layout effect 与新旧元素在同一次提交里交接。
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import {
  Check,
  Expand,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Shrink,
  Volume2,
  VolumeX
} from 'lucide-react'
import {
  Container,
  Controls,
  Gesture,
  I18nProvider,
  selectFullscreen,
  selectPiP,
  TimeSlider
} from '@videojs/react'
import { Video, VideoPlayer, usePlayer } from '@videojs/react/video'
// Video.js 部件给读屏的文案（播放器、进度条等）用简体中文，与界面一致
import '@videojs/react/i18n/locales/zh-CN/register'
import WaveSurfer from 'wavesurfer.js'
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.esm.js'
import { SHORTCUT } from '@shared/shortcut-label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Slider } from '@renderer/components/ui/slider'
import { TOOLBAR_BTN } from '@renderer/components/ui/toolbar'
import {
  arrowOwnerOf,
  FilesTreeRowContext,
  filesKeyScope,
  overlayOpen
} from '@renderer/lib/files-key-guards'
import { reachesContent } from '@renderer/lib/files-key-route'
import { stepVideoFrame, trackVideoFrames, walkVideoFrames } from '@renderer/lib/files-video-frame'
import { shortcutTitle } from '@renderer/lib/shortcut-label'
import { cn } from '@renderer/lib/utils'
import { useApp } from '@renderer/store'

/** ← / → 一次快退 / 快进的秒数 */
const SEEK_STEP_S = 5
/** 播放中按住 → 超过这么久转为倍速，不到就松开算一次快进；暂停中的视频 ← / → 同此：不到算一帧，过了转连续逐帧 */
const HOLD_DELAY_MS = 300
/** 按住 → 时的倍速 */
const HOLD_RATE = 2
/**
 * 暂停中的视频按住 ← / → 连续逐帧的节奏，按倍速计（取 Final Cut 慢放的 0.5 倍速）：只定节奏，不进入播放、不出声，
 * 也不显示倍速标记
 */
const FRAME_WALK_RATE = 0.5
/** 波形高度（px） */
const WAVEFORM_HEIGHT = 48
/** 画波形要把整个文件读进内存解码，耗时与内存随时长增长；超过这个时长不解码，波形画成一条平线 */
const WAVEFORM_MAX_DURATION_S = 10 * 60
/** 平线的峰值：全零，wavesurfer 画成一条细线 */
const FLAT_PEAKS = [[0, 0]]
/** 倍速钮的可选倍速 */
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
/**
 * 播放 / 暂停钮的实心图标。lucide 官方不出实心款，但轮廓封闭的图标填上当前色即可（音量、循环等线条图标填了会变形，保持线条）
 */
const FILLED_ICON = 'size-4 fill-current'
/** 时间读数：12px muted、等宽数位 */
const CLOCK = 'shrink-0 text-[12px] tabular-nums text-muted-foreground'
/**
 * 叠在视频画面上的操作栏一律白色（画面明暗不定，与主题无关）：就地改写操作栏用到的颜色变量，钮、读数、滑杆照常取变量；
 * 下拉菜单渲染在别处，不受影响
 */
const VIDEO_OVERLAY_COLORS =
  '[--muted-foreground:rgb(255_255_255/0.85)] [--foreground:#fff] [--fg-icon:#fff] [--bg-button-hover:rgb(255_255_255/0.2)] [--selection-row:rgb(255_255_255/0.25)] [--progress-track:rgb(255_255_255/0.3)]'
/** 视频按比例放大到铺满播放器：宽取「铺满宽」与「铺满高时的宽」中较小的，高随宽按比例（网页全屏用） */
const FIT_WIDTH = 'w-[min(100cqw,calc(100cqh*var(--video-aspect)))]'
/** 同上，只在播放器全屏时生效 */
const FIT_WIDTH_IN_FULLSCREEN =
  'group-[:fullscreen]/player:w-[min(100cqw,calc(100cqh*var(--video-aspect)))]'
/** 盖住窗口顶栏时让出它的拖动区（同 AppTitleBar 里控件的写法） */
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
/** 媒体元素上会改变操作栏读数的事件 */
const MEDIA_EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'ratechange', 'volumechange']

/** 开始播放：play() 被随后的 pause() 打断（如按住倍速很快松开）会以 AbortError 拒绝，属预期 */
function play(media: HTMLMediaElement): void {
  media.play().catch((err: unknown) => {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
  })
}

/** 播放 / 暂停 */
function togglePlay(media: HTMLMediaElement): void {
  if (media.paused) play(media)
  else media.pause()
}

/** 静音 / 取消静音；音量已被拖到 0 时没有可恢复的音量，回到满音量 */
function toggleMute(media: HTMLMediaElement): void {
  if (media.muted) media.muted = false
  else if (media.volume === 0) media.volume = 1
  else media.muted = true
}

/** 选倍速 */
function setRate(media: HTMLMediaElement, rate: number): void {
  media.playbackRate = rate
}

/** 开关循环播放 */
function setLooping(media: HTMLMediaElement, on: boolean): void {
  media.loop = on
}

/** 调音量：拖动即取消静音 */
function setVolume(media: HTMLMediaElement, volume: number): void {
  media.muted = false
  media.volume = volume
}

/** 倍速读数：至少一位小数（1.0×、0.75×） */
function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}×`
}

/** 秒数 → `m:ss`，满一小时为 `h:mm:ss`；时长未知（非有限值）按 0 */
function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.floor(seconds) : 0
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 波形与已播段的颜色：画在画布上、吃不了 CSS 变量，取元素上的实际色值（ADR-0026） */
function waveColors(el: HTMLElement): { waveColor: string; progressColor: string } {
  const style = getComputedStyle(el)
  return {
    waveColor: style.getPropertyValue('--fg-disabled'),
    progressColor: style.getPropertyValue('--fg-primary')
  }
}

/** 操作栏的读数（取自媒体元素） */
interface MediaState {
  playing: boolean
  time: number
  /** 读到元数据之前为 0 */
  duration: number
  /** 按住 → 期间是 2 */
  rate: number
  /** 实际音量 0–1，静音为 0 */
  level: number
}

function readMediaState(media: HTMLMediaElement): MediaState {
  return {
    playing: !media.paused,
    time: media.currentTime,
    duration: Number.isNaN(media.duration) ? 0 : media.duration,
    rate: media.playbackRate,
    level: media.muted ? 0 : media.volume
  }
}

const IDLE_STATE: MediaState = { playing: false, time: 0, duration: 0, rate: 1, level: 1 }

/** 跟随媒体元素的读数 */
function useMediaState(media: HTMLMediaElement | null): MediaState {
  const [state, setState] = useState(IDLE_STATE)
  useEffect(() => {
    if (!media) return
    const sync = (): void => setState(readMediaState(media))
    sync()
    for (const type of MEDIA_EVENTS) media.addEventListener(type, sync)
    return () => {
      for (const type of MEDIA_EVENTS) media.removeEventListener(type, sync)
    }
  }, [media])
  return state
}

/** 快退 / 快进；越过结尾时浏览器的 seek 自会停在结尾 */
function seekBy(media: HTMLMediaElement, delta: number): void {
  media.currentTime = Math.max(media.currentTime + delta, 0)
}

/** 暂停中的视频：← / → 逐帧 */
function framewise(media: HTMLMediaElement): media is HTMLVideoElement {
  return media instanceof HTMLVideoElement && media.paused
}

/** 播放中按住时变速，返回松开时恢复原倍速的函数 */
function playAtRate(media: HTMLMediaElement, rate: number): () => void {
  const restore = media.playbackRate
  media.playbackRate = rate
  return () => {
    media.playbackRate = restore
  }
}

export function FilesAvPreview({
  kind,
  src,
  mime,
  active
}: {
  kind: 'audio' | 'video'
  src: string
  mime: string
  /** Files Tab 可见且为当前栏时才响应键盘 */
  active: boolean
}): React.JSX.Element {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const setMedia = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
  }, [])
  /** 视频的播放器外层：全屏的是它，叠在画面上的操作栏与倍速标记全屏时才看得见 */
  const playerRef = useRef<HTMLDivElement | null>(null)
  /** 正按住 → 倍速播放（画面上出倍速标记；暂停中的视频按住逐帧不算，不出标记） */
  const [holding, setHolding] = useState(false)

  const treeRowIsDirectory = useContext(FilesTreeRowContext)
  // 播放键：空格、← / →（播放中按住 → 倍速；暂停中的视频逐帧）、F、M。焦点在播放器上时也拦下，免得控件自己的键盘操作再动一次
  useLayoutEffect(() => {
    if (!active) return
    /**
     * 播放中按下 →、或暂停中的视频按下 ← / → 起算；到点即转：播放中为 2 倍速，暂停中的视频为连续逐帧（不播放）。
     * stop 为转了之后松开时的收尾；frames 为按下时暂停中的视频，轻按算一帧
     */
    let hold: {
      key: 'arrowleft' | 'arrowright'
      timer: number
      stop: (() => void) | null
      frames: HTMLVideoElement | null
    } | null = null
    /** 松开 / 失焦 / 卸载：转了变速的收尾，没转的按需算一次（暂停中的视频退 / 进一帧，否则快进 5 秒） */
    const endHold = (short: boolean): void => {
      if (!hold) return
      window.clearTimeout(hold.timer)
      const media = mediaRef.current
      if (hold.stop) {
        hold.stop()
        setHolding(false)
      } else if (short && hold.frames) {
        stepVideoFrame(hold.frames, hold.key === 'arrowleft' ? -1 : 1)
      } else if (short && media) {
        seekBy(media, SEEK_STEP_S)
      }
      hold = null
    }
    const startHold = (media: HTMLMediaElement, key: 'arrowleft' | 'arrowright'): void => {
      if (hold) return
      const frames = framewise(media) ? media : null
      hold = {
        key,
        timer: window.setTimeout(() => {
          if (!hold) return
          if (frames) {
            hold.stop = walkVideoFrames(frames, key === 'arrowleft' ? -1 : 1, FRAME_WALK_RATE)
          } else {
            hold.stop = playAtRate(media, HOLD_RATE)
            setHolding(true)
          }
        }, HOLD_DELAY_MS),
        stop: null,
        frames
      }
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
      // ← / → 的归属同其他正文（焦点在文件树的文件夹行上时归文件树），其余播放键两边都接
      const arrow = key === 'arrowleft' || key === 'arrowright'
      if (
        arrow
          ? arrowOwnerOf(e, 'av', treeRowIsDirectory()) !== 'content'
          : !reachesContent(filesKeyScope(e.target))
      )
        return
      e.preventDefault()
      e.stopPropagation()
      if (key === 'arrowleft' || key === 'arrowright') {
        if (framewise(media) || (key === 'arrowright' && !media.paused)) {
          // 暂停中的视频逐帧、播放中按住 → 倍速：轻按与按住要到松开或到点才分得清，交给按住计时（重复事件不再起算）
          if (!e.repeat) startHold(media, key)
        } else {
          // ← 与暂停中音频的 →：每按一下快退 / 快进 5 秒，按住随按键重复连续进退，不进入播放
          seekBy(media, key === 'arrowleft' ? -SEEK_STEP_S : SEEK_STEP_S)
        }
        return
      }
      // 其余键按住时的重复事件只拦不响应
      if (e.repeat) return
      if (key === ' ') {
        togglePlay(media)
      } else if (key === 'm') {
        toggleMute(media)
      } else if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void playerRef.current?.requestFullscreen()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (hold && e.key.toLowerCase() === hold.key) endHold(true)
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
  }, [active, kind, treeRowIsDirectory])

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {kind === 'video' ? (
        <VideoView
          src={src}
          mime={mime}
          mediaRef={setMedia}
          playerRef={playerRef}
          holding={holding}
        />
      ) : (
        <AudioPlayer src={src} mime={mime} mediaRef={setMedia} holding={holding} />
      )}
    </div>
  )
}

/** 按住 → 倍速期间的标记（不接指针）；位置由调用方给，水平居中 */
function HoldRateBadge({ className }: { className: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[color:var(--border-input)] bg-elevated px-2 py-1 text-[13px] text-foreground shadow-xl',
        className
      )}
    >
      <FastForward className="size-3.5 fill-current" />
      {formatRate(HOLD_RATE)}
    </div>
  )
}

/**
 * 音视频共用的操作栏：左侧播放钮与「当前 / 总时长」，右侧倍速 · 循环 · 静音 · 音量，再接调用方追加的钮（视频的画中画、网页全屏、全屏）。
 * 只读写媒体元素本身，与外层的键盘操作互不干扰。
 */
function MediaControlBar({
  media,
  state,
  menuContainer,
  children
}: {
  media: HTMLMediaElement | null
  state: MediaState
  /** 倍速下拉的挂载处：视频全屏时只有播放器外层可见，下拉要渲染在它里面 */
  menuContainer?: RefObject<HTMLElement | null>
  children?: React.ReactNode
}): React.JSX.Element {
  const [loop, setLoop] = useState(false)
  const silent = state.level === 0
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title={shortcutTitle(state.playing ? '暂停' : '播放', SHORTCUT.avPlayPause)}
        className={TOOLBAR_BTN}
        onClick={() => {
          if (media) togglePlay(media)
        }}
      >
        {state.playing ? <Pause className={FILLED_ICON} /> : <Play className={FILLED_ICON} />}
      </button>
      <span className={cn(CLOCK, 'mr-auto')}>
        {formatClock(state.time)} / {formatClock(state.duration)}
      </span>
      <DropdownMenu>
        {/* 定宽装得下最长的「0.75×」：换倍速时钮不变宽变窄 */}
        <DropdownMenuTrigger
          title="倍速"
          className={cn(TOOLBAR_BTN, 'w-11 text-[12px] tabular-nums')}
        >
          {formatRate(state.rate)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" container={menuContainer}>
          {RATES.map((r) => (
            <DropdownMenuItem
              key={r}
              onClick={() => {
                if (media) setRate(media, r)
              }}
            >
              <Check className={cn('size-3.5 shrink-0', r !== state.rate && 'invisible')} />
              {formatRate(r)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        title="循环播放"
        // 开着时同看图四档钮的点亮态：`--selection-row` 蓝底 + 正文色，hover 不再变色
        className={cn(
          TOOLBAR_BTN,
          loop &&
            'bg-[var(--selection-row)] text-foreground hover:bg-[var(--selection-row)] hover:text-foreground'
        )}
        onClick={() => {
          if (!media) return
          setLooping(media, !loop)
          setLoop(!loop)
        }}
      >
        <Repeat className="size-4" />
      </button>
      <button
        type="button"
        title={shortcutTitle(silent ? '取消静音' : '静音', SHORTCUT.avMute)}
        className={TOOLBAR_BTN}
        onClick={() => {
          if (media) toggleMute(media)
        }}
      >
        {silent ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
      <Slider
        label="音量"
        className="w-20"
        value={state.level}
        max={1}
        step={0.01}
        onValueChange={(next) => {
          if (media) setVolume(media, next)
        }}
      />
      {children}
    </div>
  )
}

/**
 * 音频播放条：上行波形，下行是共用的操作栏。波形即进度条：已播段染成正文色，点击或拖动跳转，
 * 悬停出竖线与所指时间。播放仍由这里的 `<audio>` 承担，wavesurfer 只借它画波形与跳转，键盘操作因此与视频同一套。
 */
function AudioPlayer({
  src,
  mime,
  mediaRef,
  holding
}: {
  src: string
  mime: string
  /** 把媒体元素交给外层的键盘操作 */
  mediaRef: (el: HTMLMediaElement | null) => void
  /** 正按住 → 倍速：波形上方浮出倍速标记 */
  holding: boolean
}): React.JSX.Element {
  const [audio, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const setAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      setAudioElement(el)
      mediaRef(el)
    },
    [mediaRef]
  )
  const state = useMediaState(audio)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const surferRef = useRef<WaveSurfer | null>(null)
  const theme = useApp((s) => s.theme)
  /** 解码失败：同超长音频，波形画成平线 */
  const [undecodable, setUndecodable] = useState(false)
  /** 波形已画出（淡入） */
  const [drawn, setDrawn] = useState(false)

  const known = state.duration > 0
  const flat =
    undecodable || (Number.isFinite(state.duration) && state.duration > WAVEFORM_MAX_DURATION_S)

  // 读到时长后才建：要先凭时长决定解码还是画平线。给了峰值与时长，wavesurfer 就不再读文件、不解码
  useEffect(() => {
    const container = waveRef.current
    if (!audio || !container || !known) return
    const surfer = WaveSurfer.create({
      container,
      media: audio,
      height: WAVEFORM_HEIGHT,
      normalize: true,
      cursorWidth: 0,
      dragToSeek: true,
      hideScrollbar: true,
      ...waveColors(container),
      ...(flat && { peaks: FLAT_PEAKS, duration: audio.duration }),
      plugins: [
        HoverPlugin.create({
          lineColor: 'var(--fg-muted)',
          labelBackground: 'var(--bg-elevated)',
          labelColor: 'var(--fg-primary)',
          labelSize: 12,
          formatTimeCallback: formatClock
        })
      ]
    })
    surfer.on('ready', () => setDrawn(true))
    surfer.on('error', () => setUndecodable(true))
    surferRef.current = surfer
    return () => {
      surferRef.current = null
      surfer.destroy()
    }
  }, [audio, known, flat])

  // 换主题：CSS 变量已随之翻转，重取色值重画
  useEffect(() => {
    if (waveRef.current) surferRef.current?.setOptions(waveColors(waveRef.current))
  }, [theme])

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-3">
      <audio ref={setAudio} preload="metadata">
        <source src={src} type={mime} />
      </audio>
      <div className="relative">
        <div
          ref={waveRef}
          className={cn(
            'h-12 transition-opacity duration-150',
            drawn ? 'opacity-100' : 'opacity-0'
          )}
        />
        {holding && <HoldRateBadge className="bottom-full mb-3" />}
      </div>
      <MediaControlBar media={audio} state={state} />
    </div>
  )
}

/**
 * 视频播放器（Video.js，ADR-0065）：画面居中，进度条与共用的操作栏叠在画面底部（底部渐黑、白色控件），
 * 播放中鼠标静止一会儿即隐去（连同指针），暂停时常显；单击画面播放 / 暂停，双击全屏。操作栏末尾照 B 站
 * 依次是画中画、网页全屏（铺满应用窗口，Esc 退出）、全屏；全屏的是整个播放器，操作栏与倍速标记全屏时照样显示。
 * 叠层用 CSS 锚点定位贴住画面本身，不随留白跑。
 */
function VideoView({
  src,
  mime,
  mediaRef,
  playerRef,
  holding
}: {
  src: string
  mime: string
  /** 把媒体元素交给外层的键盘操作 */
  mediaRef: (el: HTMLMediaElement | null) => void
  /** 播放器外层（全屏对象），交给外层的 F 键 */
  playerRef: RefObject<HTMLDivElement | null>
  /** 正按住 → 倍速：画面顶部浮出倍速标记 */
  holding: boolean
}): React.JSX.Element {
  const [video, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const setVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      setVideoElement(el)
      mediaRef(el)
    },
    [mediaRef]
  )
  const state = useMediaState(video)
  const [webFullscreen, setWebFullscreen] = useState(false)
  /** 画面宽高比；读到元数据之前为 null */
  const [aspect, setAspect] = useState<number | null>(null)

  // 暂停时 ← / → 逐帧要知道画面上是哪一帧
  useEffect(() => (video ? trackVideoFrames(video) : undefined), [video])

  // 网页全屏时 Esc 退出（全屏时 Esc 先归浏览器退出全屏；弹层开着时归弹层）
  useEffect(() => {
    if (!webFullscreen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || document.fullscreenElement || overlayOpen()) return
      e.preventDefault()
      e.stopPropagation()
      setWebFullscreen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [webFullscreen])

  return (
    <I18nProvider locale="zh-CN">
      <VideoPlayer>
        {/* 锚点名限定在本播放器内，分栏里同时开着两个视频时各贴各的画面。网页全屏 = 固定铺满应用窗口
          （盖住顶栏，顶栏的拖动区要让出来）；全屏时浏览器再把它铺满屏幕 */}
        <Container
          ref={playerRef}
          className={cn(
            'group/player flex cursor-none items-center justify-center outline-none [container-type:size] [anchor-scope:--av-video] data-[controls-visible]:cursor-auto',
            webFullscreen ? 'fixed inset-0 z-50 bg-black' : 'relative size-full'
          )}
          style={webFullscreen ? NO_DRAG : undefined}
        >
          {/* 窗口里按原始大小、放不下才缩小（同原生控件）；全屏与网页全屏按比例放大到铺满 */}
          <Video
            ref={setVideo}
            preload="metadata"
            onLoadedMetadata={(e) =>
              setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || null)
            }
            style={aspect ? ({ '--video-aspect': aspect } as React.CSSProperties) : undefined}
            className={cn(
              'max-h-full max-w-full [anchor-name:--av-video]',
              aspect && (webFullscreen ? FIT_WIDTH : FIT_WIDTH_IN_FULLSCREEN)
            )}
          >
            <source src={src} type={mime} />
          </Video>
          <Gesture type="tap" action="togglePaused" pointer="mouse" />
          <Gesture type="doubletap" action="toggleFullscreen" />
          <Controls.Root>
            <Controls.Content
              className={cn(
                VIDEO_OVERLAY_COLORS,
                'pointer-events-none absolute right-[anchor(--av-video_right)] bottom-[anchor(--av-video_bottom)] left-[anchor(--av-video_left)] flex flex-col gap-1 bg-gradient-to-t from-black/60 to-transparent px-3 pt-8 pb-2 opacity-0 transition-opacity duration-150 data-[visible]:pointer-events-auto data-[visible]:opacity-100'
              )}
            >
              <VideoTimeSlider />
              <MediaControlBar media={video} state={state} menuContainer={playerRef}>
                <PiPButton />
                <button
                  type="button"
                  title={webFullscreen ? '退出网页全屏' : '网页全屏'}
                  className={TOOLBAR_BTN}
                  onClick={() => setWebFullscreen((on) => !on)}
                >
                  {webFullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />}
                </button>
                <FullscreenButton />
              </MediaControlBar>
            </Controls.Content>
          </Controls.Root>
          {holding && (
            <HoldRateBadge className="top-[calc(anchor(--av-video_top)+12px)] left-[anchor(--av-video_center)]" />
          )}
        </Container>
      </VideoPlayer>
    </I18nProvider>
  )
}

/** 视频进度条：轨道高 4px、全圆角，已缓冲段叠一层轨道色，已播段与 12px 圆形滑块为图标色（同音量滑杆）；命中区高 16px */
function VideoTimeSlider(): React.JSX.Element {
  return (
    <TimeSlider.Root className="relative flex h-4 items-center" thumbAlignment="edge">
      <TimeSlider.Track className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--progress-track)]">
        <TimeSlider.Buffer className="absolute inset-y-0 left-0 w-[var(--media-slider-buffer)] bg-[var(--progress-track)]" />
        <TimeSlider.Fill className="absolute inset-y-0 left-0 w-[var(--media-slider-fill)] bg-[var(--fg-icon)]" />
      </TimeSlider.Track>
      <TimeSlider.Thumb className="absolute left-[var(--media-slider-fill)] size-3 -translate-x-1/2 rounded-full bg-[var(--fg-icon)] outline-none" />
    </TimeSlider.Root>
  )
}

/**
 * 画中画 / 退出画中画：视频弹到浮在所有窗口之上的小窗里播放。平台不支持时不显示；暂时不可用（读到视频信息之前）
 * 置灰而不隐去，免得读完才冒出来（全屏钮同）
 */
function PiPButton(): React.JSX.Element | null {
  const pip = usePlayer(selectPiP)
  if (!pip || pip.pictureInPictureAvailability === 'unsupported') return null
  return (
    <button
      type="button"
      title={pip.isPictureInPicture ? '退出画中画' : '画中画'}
      disabled={pip.pictureInPictureAvailability !== 'available'}
      className={TOOLBAR_BTN}
      onClick={() => {
        void (pip.isPictureInPicture ? pip.exitPictureInPicture() : pip.requestPictureInPicture())
      }}
    >
      <PictureInPicture2 className="size-4" />
    </button>
  )
}

/** 全屏 / 退出全屏（全屏整个播放器） */
function FullscreenButton(): React.JSX.Element | null {
  const fullscreen = usePlayer(selectFullscreen)
  if (!fullscreen || fullscreen.fullscreenAvailability === 'unsupported') return null
  return (
    <button
      type="button"
      title={shortcutTitle(fullscreen.isFullscreen ? '退出全屏' : '全屏', SHORTCUT.avFullscreen)}
      disabled={fullscreen.fullscreenAvailability !== 'available'}
      className={TOOLBAR_BTN}
      onClick={() => {
        void (fullscreen.isFullscreen
          ? fullscreen.exitFullscreen()
          : fullscreen.requestFullscreen())
      }}
    >
      {fullscreen.isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
    </button>
  )
}
