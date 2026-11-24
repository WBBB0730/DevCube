/**
 * Files 视频逐帧（暂停时 ← / →，docs/prd/files-tab.md「音视频快捷键」）。
 *
 * 照剪辑软件的手感：按一下就记一帧，连按 N 下必走 N 帧；按住时按固定节奏一帧帧地走（walkVideoFrames），
 * 不进入播放、不出声。每一步只推进目标位置，不等画面；同一时间只跳一次，跳完再跳到最新的目标——浏览器收到新的跳转
 * 会放弃没完成的那次，关键帧稀疏的视频一次跳转要几十到上百毫秒，接连跳会一直完成不了、画面冻住。画面因此按解码的
 * 速度更新，中间的帧可能跳过，停手后落在准确的那一帧。
 *
 * 浏览器不给帧率，靠逐帧回调（requestVideoFrameCallback）读出画面上那一帧的准确时间：正常或更慢播放中相邻两帧之差
 * 即帧长（快放时浏览器会跳着显示，间隔是两帧以上，不算；取量到过的最小值）；没播过就试探着跳几次量出来（试探期间
 * 的按键攒着，量完一并走）：往回跳一点点，落到的就是前一帧；往前先跳一段落到后面某一帧，再对半收拢到紧挨着的那一帧。
 * 跳到目标帧的中间而不是边界，免得浮点误差落回原帧；每次画面落在最新目标上都以实际那一帧为准重新起算，
 * 帧率不固定的视频误差不累积。
 */
import { clamp } from 'es-toolkit'

/** 往回试探跳的距离：远小于一帧，落到的必是前一帧 */
const PROBE_BACK_S = 0.001
/** 往前试探先跳的距离：每秒 20～40 帧的视频一次就落到下一帧，更高帧率再对半收拢一两次，更低帧率加倍再找 */
const PROBE_FORWARD_S = 0.05
/** 帧长的合理上限：最低按每秒 3 帧 */
const MAX_FRAME_S = 1 / 3
/** 判断两个播放位置相同的容差：远小于一帧 */
const SAME_POSITION_S = 1e-4
/** 帧长还没量到时，按住走的节奏按每秒 30 帧（量到后即按实际帧长） */
const FALLBACK_FRAME_S = 1 / 30

interface FrameState {
  /** 画面上那一帧的时间；还没出过帧为 null */
  time: number | null
  /** 帧长；还没量到为 null */
  duration: number | null
  /** 逐帧的目标：所在帧的起点，与为此设的播放位置（帧的中间）；播放或别的跳转后作废 */
  target: { frame: number; at: number } | null
  /** 最近一次由逐帧发出的跳转位置：据此认出别处（进度条等）发起的跳转 */
  issued: number | null
  /** 逐帧发出的跳转还没完成 */
  seeking: boolean
  /** 正在试探帧长 */
  probing: boolean
  /** 试探期间攒下的步数（进为正、退为负） */
  pending: number
}

const states = new WeakMap<HTMLVideoElement, FrameState>()

function samePosition(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_POSITION_S
}

/** 发出一次跳转 */
function issue(video: HTMLVideoElement, state: FrameState, at: number): void {
  state.issued = at
  state.seeking = true
  video.currentTime = at
}

/** 开始跟踪画面上的帧（视频挂载时调用），返回停止函数 */
export function trackVideoFrames(video: HTMLVideoElement): () => void {
  const state: FrameState = {
    time: null,
    duration: null,
    target: null,
    issued: null,
    seeking: false,
    probing: false,
    pending: 0
  }
  states.set(video, state)
  let presented = -1
  let handle = 0
  const onFrame: VideoFrameRequestCallback = (_now, meta) => {
    // 正常或更慢播放中连续呈现的两帧（中间没掉帧、不是跳转）之差就是帧长；快放时浏览器会跳着显示，不算
    const gap = state.time === null ? 0 : meta.mediaTime - state.time
    if (
      !video.paused &&
      video.playbackRate <= 1 &&
      meta.presentedFrames === presented + 1 &&
      gap > 0 &&
      gap <= MAX_FRAME_S
    ) {
      state.duration = Math.min(state.duration ?? gap, gap)
    }
    state.time = meta.mediaTime
    presented = meta.presentedFrames
    // 画面落在了最新的目标上：以实际那一帧为准
    const { target } = state
    if (target && !video.seeking && samePosition(video.currentTime, target.at)) {
      target.frame = meta.mediaTime
    }
    handle = video.requestVideoFrameCallback(onFrame)
  }
  // 别处发起的跳转（进度条、快进快退等）：逐帧的目标作废，下次从画面上那一帧起算
  const onSeeking = (): void => {
    if (state.issued === null || !samePosition(video.currentTime, state.issued)) state.target = null
  }
  // 一次跳转完成：目标在此期间又变了，就接着跳到最新的目标
  const onSeeked = (): void => {
    state.seeking = false
    const { target } = state
    if (target && !samePosition(video.currentTime, target.at)) issue(video, state, target.at)
  }
  const onPlay = (): void => {
    state.target = null
  }
  handle = video.requestVideoFrameCallback(onFrame)
  video.addEventListener('seeking', onSeeking)
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('play', onPlay)
  return () => {
    video.cancelVideoFrameCallback(handle)
    video.removeEventListener('seeking', onSeeking)
    video.removeEventListener('seeked', onSeeked)
    video.removeEventListener('play', onPlay)
    states.delete(video)
  }
}

/** 当前所在帧的起点：有逐帧目标就接着它算（画面可能还没跟上），否则取画面上那一帧 */
function currentFrame(video: HTMLVideoElement, state: FrameState): number {
  return state.target?.frame ?? state.time ?? video.currentTime
}

/**
 * 从 from 这一帧（缺省为当前所在帧）走 steps 帧（帧长已知）：目标立刻推进，没有跳转在进行就马上跳；
 * 到头停在第一帧 / 最后一帧
 */
function move(
  video: HTMLVideoElement,
  state: FrameState,
  steps: number,
  duration: number,
  from = currentFrame(video, state)
): void {
  const end = Number.isFinite(video.duration) ? video.duration : Infinity
  const frame = clamp(from + steps * duration, 0, Math.max(0, end - duration))
  const at = frame + duration / 2
  state.target = { frame, at }
  if (!state.seeking) issue(video, state, at)
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** 跳到 t，等新的一帧送上画面后返回画面上那一帧的时间（只用于试探，试探是逐次进行的） */
async function seekAndSettle(
  video: HTMLVideoElement,
  state: FrameState,
  t: number
): Promise<number | null> {
  await new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    issue(video, state, t)
  })
  // seeked 之后，新帧送到合成器（逐帧回调）还要一两帧的时间
  await nextAnimationFrame()
  await nextAnimationFrame()
  return state.time
}

/**
 * 量帧长（返回 null 为到头或量不出）。往回：跳到当前帧起点之前一点点，落到的就是前一帧，两帧起点之差即帧长。
 * 往前：先跳 PROBE_FORWARD_S（落在原帧就加倍再跳），落到后面某一帧；再跳到两者正中，落到更近的帧就收拢过去，
 * 仍落在原帧说明已紧挨着——帧长一致时，正中到那一帧之间放不下第二个帧起点
 */
async function measureFrame(
  video: HTMLVideoElement,
  state: FrameState,
  base: number,
  direction: number
): Promise<number | null> {
  const end = Number.isFinite(video.duration) ? video.duration : Infinity
  if (direction < 0) {
    if (base - PROBE_BACK_S < 0) return null
    const time = await seekAndSettle(video, state, base - PROBE_BACK_S)
    return time !== null && time < base ? base - time : null
  }
  let gap: number | null = null
  for (let offset = PROBE_FORWARD_S; gap === null && offset <= MAX_FRAME_S; offset *= 2) {
    if (base + offset > end) return null
    const time = await seekAndSettle(video, state, base + offset)
    if (time !== null && time > base) gap = time - base
  }
  while (gap !== null) {
    const time = await seekAndSettle(video, state, base + gap / 2)
    if (time === null || time <= base) break
    gap = time - base
  }
  return gap
}

/** 试探帧长：朝第一下按键的方向量出帧长，再从原来那一帧把攒下的步数一并走完 */
async function probe(video: HTMLVideoElement, state: FrameState): Promise<void> {
  state.probing = true
  const base = currentFrame(video, state)
  try {
    state.duration = await measureFrame(video, state, base, Math.sign(state.pending))
  } finally {
    state.probing = false
  }
  const steps = state.pending
  state.pending = 0
  if (state.duration !== null && steps !== 0) move(video, state, steps, state.duration, base)
}

/** 退一帧（-1）或进一帧（1）：立刻生效，不等画面；到头不动 */
export function stepVideoFrame(video: HTMLVideoElement, direction: -1 | 1): void {
  const state = states.get(video)
  if (!state) return
  if (state.duration !== null && !state.probing) {
    move(video, state, direction, state.duration)
    return
  }
  state.pending += direction
  if (!state.probing) void probe(video, state)
}

/**
 * 按住 ← / → 时往回（-1）或往前（1）连续逐帧：按帧长与 rate 定节奏一帧帧地跳，不进入播放、不出声，返回停止函数。
 * 位置匀速移动，画面按解码的速度跟上；视频一开始播放（空格、点播放钮）就停下
 */
export function walkVideoFrames(
  video: HTMLVideoElement,
  direction: -1 | 1,
  rate: number
): () => void {
  let timer = 0
  const tick = (): void => {
    if (!video.paused) return
    stepVideoFrame(video, direction)
    const frame = states.get(video)?.duration ?? FALLBACK_FRAME_S
    timer = window.setTimeout(tick, (frame / rate) * 1000)
  }
  tick()
  return () => window.clearTimeout(timer)
}
