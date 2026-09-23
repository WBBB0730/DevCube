/**
 * Files Tab PDF 缩略图：一份文档一个渲染器，管页面尺寸、排队画图与缓存（取页顺序见 files-page-thumbnails）。
 * PDF.js 组件层不导出其阅读器的 PDFThumbnailViewer，这里照它的模型自写、重活仍交给库：
 * - 一次只画一张，永远先画离侧栏视口最近的页；视口画完再顺着滚动方向预取有限几屏，不画整本；
 * - 画好的小图存成压缩图片的 blob 对象 URL（二进制不转 base64、由浏览器托管不进 JS 堆、同图反复挂载共用解码；
 *   渲染层 CSP 的 img-src 为此放行 blob:），整个文档期间不扔，滚出去再滚回来立刻显示，销毁时统一回收；
 * - 开画的不半途作废，只有销毁才作废——快速滚动不白干；
 * - 每画完一张发 PDF.js 的 `thumbnailrendered`，阅读器据此释放不在其缓冲区内的页资源
 *  （否则画过小图的页把解好的大图一直留在内存里，图片多的文档越滚越占）；
 * - 等正文首页画完（`onePageRendered`）才开工，不和正文抢工作线程。
 */
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EventBus } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { nextThumbnailPage, PAGE_THUMB_W, type ThumbnailWindow } from './files-page-thumbnails'

/** 视口画完后顺着滚动方向预取的屏数，与反方向补的屏数（一屏 = 当前视口内的页数） */
const AHEAD_SCREENS = 2
const BEHIND_SCREENS = 1
/** 缓存用 JPEG：白底页面几十 KB 一张，几百页也就几 MB；PNG 遇到照片页会到一两百 KB */
const THUMB_MIME = 'image/jpeg'
const THUMB_QUALITY = 0.9

export class PdfThumbnailRenderer {
  readonly #doc: PDFDocumentProxy
  readonly #bus: EventBus
  readonly #ready: Promise<unknown>
  /** 每页小图高（CSS px）；null = 尺寸尚未取齐 */
  #heights: number[] | null = null
  #urls = new Map<number, string>()
  /** 画不出来的页：不再重试，格子留白页 */
  #failed = new Set<number>()
  #window: ThumbnailWindow | null = null
  #listeners = new Set<() => void>()
  #version = 0
  #task: RenderTask | null = null
  #pumping = false
  #dead = false
  /** 一次只画一张，一块画布反复用 */
  #canvas: HTMLCanvasElement | null = null

  constructor(doc: PDFDocumentProxy, bus: EventBus, ready: Promise<unknown> | null) {
    this.#doc = doc
    this.#bus = bus
    this.#ready = ready ?? Promise.resolve()
    // 一次取齐全部页面尺寸：阅读器 setDocument 已把页面对象全部预取，这里只是命中缓存
    Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
      .then((pages) => {
        if (this.#dead) return
        this.#heights = pages.map((p) => {
          const v = p.getViewport({ scale: 1 })
          return Math.round((PAGE_THUMB_W * v.height) / v.width)
        })
        this.#emit()
      })
      .catch(() => {
        /* 文档已销毁 */
      })
  }

  get heights(): number[] | null {
    return this.#heights
  }

  /** 已画好的小图 URL；未画返回 undefined */
  url(page: number): string | undefined {
    return this.#urls.get(page)
  }

  /** 给 useSyncExternalStore：尺寸取齐或画好一张就通知一次 */
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => {
      this.#listeners.delete(fn)
    }
  }

  getVersion = (): number => this.#version

  /** 侧栏视口变了（滚动 / 显隐）：重定优先级并推动队列；null = 侧栏收起，手头这张画完就停 */
  setWindow(win: ThumbnailWindow | null): void {
    this.#window = win
    if (win) void this.#pump()
  }

  destroy(): void {
    this.#dead = true
    this.#window = null
    this.#task?.cancel()
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
    this.#listeners.clear()
    this.#canvas = null
  }

  #emit(): void {
    this.#version++
    for (const fn of this.#listeners) fn()
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return
    this.#pumping = true
    try {
      await this.#ready
      while (!this.#dead && this.#window) {
        const win = this.#window
        const screen = win.last - win.first + 1
        const page = nextThumbnailPage(
          win,
          this.#doc.numPages,
          (n) => this.#urls.has(n) || this.#failed.has(n),
          AHEAD_SCREENS * screen,
          BEHIND_SCREENS * screen
        )
        if (page === null) break
        await this.#render(page)
      }
    } finally {
      this.#pumping = false
    }
  }

  async #render(page: number): Promise<void> {
    try {
      const pdfPage = await this.#doc.getPage(page)
      if (this.#dead) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: PAGE_THUMB_W / base.width })
      // 按设备像素比画，2 倍屏清晰（同 PDF.js 自家缩略图的 OutputScale 做法）
      const ratio = window.devicePixelRatio || 1
      const canvas = (this.#canvas ??= document.createElement('canvas'))
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      this.#task = pdfPage.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined
      })
      await this.#task.promise
      this.#task = null
      if (this.#dead) return
      // 异步编码不占主线程；blob 由浏览器托管
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, THUMB_MIME, THUMB_QUALITY)
      )
      if (this.#dead) return
      if (!blob) throw new Error('缩略图编码失败')
      this.#urls.set(page, URL.createObjectURL(blob))
      // 告诉阅读器这页的小图画完了：不在它缓冲区内的页由它释放解码资源（PDFViewer 监听此事件）
      this.#bus.dispatch('thumbnailrendered', { source: this, pageNumber: page, pdfPage })
      this.#emit()
    } catch {
      // 取消（销毁）、文档已销毁或该页画不出来：不重试
      this.#task = null
      if (!this.#dead) this.#failed.add(page)
    }
  }
}
