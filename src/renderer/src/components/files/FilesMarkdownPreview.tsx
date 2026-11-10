// Files Tab · Markdown 预览：react-markdown + GFM。原始 HTML 照 GitHub 的白名单渲染，脚本、事件属性与 style 去掉（见 lib/files-markdown）；
// 网络图片照原地址加载；相对路径图片解析到项目内后经 dc-media 协议流式读取（越界 / 非图片不渲染；服务器上的文件不解析，
// 相对图片不显示）；链接一律拦截默认跳转，http/https/mailto 交给系统浏览器，其余（锚点 / 相对链接）不动作。
// 代码块右上角悬停出复制钮，复制代码原文，成功后换勾片刻。
// 文首的 YAML frontmatter 画成键值表，写错或不是键值对的原样成代码块（见 lib/files-markdown）。
// 正文可选中复制；Cmd+F 在渲染后的正文里查找（换算见 lib/files-markdown），查找会话与编辑态共用（切换不关、不清空），
// 高亮同 PPT 走 CSS Custom Highlight、不改页面。
// 阅读位置与编辑器共用「视口顶边所在的源码行」：块元素标着源码起始行（rehypeSourceLines），以块为对应点分段换算，
// 所以两态切换停在同一处内容；按文件重挂，换文件从头开始（docs/prd/files-tab.md「阅读位置」）。
// 目录（FilesMarkdownToc）列出源码里写下的标题，点击跳转与当前标题都走同一套源码行换算；滚动区放得下时可停靠在正文左侧的
// 留白里；侧边没显示时（收着或放不下）悬停工具栏的目录钮浮出抽屉（摆法报给 FilesTextEditor）。
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import Markdown, { type Components } from 'react-markdown'
import { isExternalLink } from '@shared/external-link'
import { buildFilesMediaUrl } from '@shared/files'
import { resolveWithinProject } from '@shared/files-path'
import { imageMimeOf } from '@shared/git'
import { findHighlights, scrollRangeToCenter } from '@renderer/lib/find-highlight'
import {
  buildMarkdownFindIndex,
  isInlineTag,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REMARK_REHYPE_OPTIONS,
  markdownCodeText,
  markdownFindSpans,
  markdownTocCurrent,
  markdownTocDockWidth,
  markdownTocLevels,
  NO_TOC,
  type MarkdownFindIndexBlock,
  type MarkdownTocState
} from '@renderer/lib/files-markdown'
import { usePagedPreviewKeys } from '@renderer/lib/files-paged-preview'
import {
  lineAtPos,
  monotonicLinePoints,
  posAtLine,
  type FilesViewState,
  type LinePoint
} from '@renderer/lib/files-view-state'
import { compileTextFind } from '@renderer/lib/text-find'
import { useFindCursor } from '@renderer/lib/use-find-cursor'
import type { FindSession } from '@renderer/lib/use-find-session'
import { CopyButton } from '@renderer/components/ui/copy-button'
import { FilesLocalContext } from './files-local-context'
import { FilesMarkdownToc, FilesMarkdownTocDrawer, type MarkdownTocItem } from './FilesMarkdownToc'
import { FindBar } from './FindBar'

function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

function decodeMaybe(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

function isBlockElement(node: Node | null): boolean {
  return node instanceof Element && !isInlineTag(node.localName)
}

/**
 * 正文按块收集文字节点。不算的：块与块之间排版用的换行（紧挨块元素的纯空白节点，页面上不显示），
 * 以及只给读屏用的隐藏文字（GFM 脚注区的标题）。
 */
function collectFindBlocks(body: HTMLElement): { nodes: Text[]; pre: boolean }[] {
  const blocks: { el: Element; nodes: Text[]; pre: boolean }[] = []
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('.sr-only') ||
      (/^\s*$/.test(n.textContent ?? '') &&
        (isBlockElement(n.previousSibling) || isBlockElement(n.nextSibling)))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
  })
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    let el = node.parentElement!
    while (el !== body && isInlineTag(el.localName)) el = el.parentElement!
    let block = blocks.at(-1)
    if (block?.el !== el) {
      block = { el, nodes: [], pre: el.closest('pre') !== null }
      blocks.push(block)
    }
    block.nodes.push(node)
  }
  return blocks
}

const NO_MATCH = { total: 0, current: -1 }

/** 源码里写下的标题都带源码行；GFM 脚注区生成的读屏标题没有，不进目录 */
const TOC_HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((t) => `${t}[data-line]`).join(',')

/** 目录：正文里的标题按文档序，显示文字折叠空白；没有文字的（如只有一张图）不列 */
function collectToc(body: HTMLElement): MarkdownTocItem[] {
  const headings = Array.from(body.querySelectorAll<HTMLElement>(TOC_HEADINGS), (el) => ({
    line: Number(el.dataset.line),
    depth: Number(el.localName[1]),
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  })).filter((h) => h.text !== '')
  const levels = markdownTocLevels(headings.map((h) => h.depth))
  return headings.map(({ line, text }, i) => ({ line, level: levels[i], text }))
}

// 代码块的复制钮：盖在右上角、不占布局（同工作树下拉的行尾钮），悬停代码块时渐显；带代码块底色，横向滚动的长行从它底下过不透出来
const CODE_COPY_BTN =
  'absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded bg-panel text-muted-foreground transition hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'

/** 代码块：右上角悬停出「复制」钮，复制代码原文，成功后换勾片刻 */
function MarkdownCodeBlock({
  code,
  ...rest
}: React.ComponentProps<'pre'> & { code: string }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  // 钮在 pre 之外：pre 自己横向滚动，钮放在里面会跟着代码滚走
  return (
    <div
      className="files-md-code relative"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <pre {...rest} />
      <CopyButton
        text={code}
        title="复制"
        visible={hovered}
        className={CODE_COPY_BTN}
        iconClassName="size-3.5"
      />
    </div>
  )
}

/** 文档序的命中里第一个顶边不在 `top` 之上的（顶边随文档序不减，对半找）；都在其上回到第一个 */
function firstRangeBelow(ranges: readonly Range[], top: number): number {
  let lo = 0
  let hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid].getBoundingClientRect().top < top) lo = mid + 1
    else hi = mid
  }
  return lo < ranges.length ? lo : 0
}

export function FilesMarkdownPreview({
  path,
  content,
  projectRoot,
  active,
  find,
  viewState,
  toc,
  onTocChange,
  onTocDrawerHover
}: {
  path: string
  content: string
  projectRoot: string
  /** Files Tab 可见时才响应键盘 */
  active: boolean
  /** 查找会话：与编辑态共用，切换不关、不清空 */
  find: FindSession
  /** 这个文件的阅读位置：与编辑态共用源码行 */
  viewState: FilesViewState
  /** 侧边的目录开着（与 PDF / PPT 缩略图共用一个开关，归 FilesPane）；放不下侧边时不显示 */
  toc: boolean
  /** 目录的摆法变了即报（工具栏的目录钮据此出现、点了响不响应）；卸载时报 NO_TOC */
  onTocChange: (state: MarkdownTocState) => void
  /** 鼠标进出抽屉（与进出目录钮一起算悬停，归 FilesTextEditor） */
  onTocDrawerHover: (event: 'enter' | 'leave') => void
}): React.JSX.Element {
  const local = useContext(FilesLocalContext)
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { open, round, openFind } = find
  const { query, caseSensitive, wholeWord, regexp } = find.bar
  // 起点要读页面，不经它记（见下面的 startRef）
  const cursor = useFindCursor(round, null)
  /**
   * 本轮查找的起点（这一轮开始时视口顶边的滚动位置），首个命中取它及之后的第一个，同 PDF / PPT 从当前页起；
   * 要读页面，布局阶段才记。滚不滚过去也以它记本轮的首个命中
   */
  const startRef = useRef<{ round: number; top: number } | null>(null)
  /** 命中数与当前命中下标：命中区间随页面文字走，布局阶段才算得出 */
  const [found, setFound] = useState(NO_MATCH)
  /** 正文的查找索引：随渲染出的正文建一次（打开查找或正文变了），每次输入只在其中匹配；关查找即丢 */
  const indexRef = useRef<{
    body: React.ReactNode
    nodes: Text[][]
    index: MarkdownFindIndexBlock[]
  } | null>(null)

  const components = useMemo<Components>(() => {
    const dir = path.slice(0, path.lastIndexOf('/'))
    return {
      a: ({ href, children, ...rest }) => (
        <a
          {...rest}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (href !== undefined && isExternalLink(href)) {
              void window.api.openExternal(href)
            }
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, ...rest }) => {
        let resolved = typeof src === 'string' ? src : undefined
        if (resolved !== undefined && !hasScheme(resolved)) {
          const logical = local
            ? resolveWithinProject(projectRoot, dir + '/' + decodeMaybe(resolved))
            : null
          const mime = logical === null ? null : imageMimeOf(logical)
          resolved =
            logical !== null && mime !== null
              ? buildFilesMediaUrl(projectRoot, logical, mime)
              : undefined
        }
        return <img {...rest} src={resolved} alt={alt ?? ''} />
      },
      pre: ({ node, ...rest }) => <MarkdownCodeBlock {...rest} code={markdownCodeText(node!)} />
    }
  }, [path, projectRoot, local])

  // 正文只随内容与渲染组件重渲染：react-markdown 每次渲染都整篇重新解析，查找打字等无关的重渲染不能连带它
  const body = useMemo(
    () => (
      <Markdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        remarkRehypeOptions={MARKDOWN_REMARK_REHYPE_OPTIONS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </Markdown>
    ),
    [content, components]
  )

  // —— 阅读位置 ——
  /** 源码总行数：最后一块之后到文末的那段也按比例对应 */
  const lineCount = useMemo(() => content.split('\n').length, [content])
  /**
   * 源码行与滚动内容高度的对应点（各块的顶边，加上首尾两端）：随排版缓存，正文重渲染或尺寸一变（图片加载、拖窗口）即作废
   */
  const pointsRef = useRef<LinePoint[] | null>(null)
  const linePoints = useCallback((): LinePoint[] => {
    const container = containerRef.current
    const bodyEl = bodyRef.current
    if (!container || !bodyEl) return []
    if (pointsRef.current) return pointsRef.current
    const top = container.getBoundingClientRect().top - container.scrollTop
    const blocks = Array.from(bodyEl.querySelectorAll<HTMLElement>('[data-line]'), (el) => ({
      line: Number(el.dataset.line),
      pos: el.getBoundingClientRect().top - top
    }))
    pointsRef.current = monotonicLinePoints([
      { line: 0, pos: 0 },
      ...blocks,
      { line: lineCount, pos: container.scrollHeight }
    ])
    return pointsRef.current
  }, [lineCount])

  // 正文（重新）渲染后块的位置作废，按记着的源码行落位：挂载即恢复阅读位置，内容在别处变了也停在同一处。
  // 须在查找之前：新一轮查找从视口顶边起找
  useLayoutEffect(() => {
    pointsRef.current = null
    const container = containerRef.current
    const line = viewState.get('line')
    if (container && line !== undefined) container.scrollTop = posAtLine(linePoints(), line)
  }, [body, linePoints, viewState])

  // —— 目录 ——
  const [tocItems, setTocItems] = useState<MarkdownTocItem[]>([])
  const tocLines = useMemo(() => tocItems.map((item) => item.line), [tocItems])
  /** 当前标题的下标；-1 = 视口顶边还在第一个标题之前 */
  const [tocCurrent, setTocCurrent] = useState(-1)
  /** 点目录跳转后，滚动位置没再变就一直点亮点的那一项：文末几节滚不到视口顶边，按位置算会点亮前面的 */
  const tocPinRef = useRef<{ index: number; scrollTop: number } | null>(null)

  // 正文（重新）渲染后重列标题（同查找索引，读渲染出的页面：原始 HTML 写的标题也算）
  useLayoutEffect(() => {
    tocPinRef.current = null
    setTocItems(bodyRef.current ? collectToc(bodyRef.current) : [])
  }, [body])

  /** 停靠的目录宽，随滚动区宽度定；null = 放不下侧边 */
  const [tocDock, setTocDock] = useState<number | null>(null)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = (): void => {
      // Tab 切走（display:none）时宽为 0：不算，留着切走前的摆法
      if (container.clientWidth > 0) setTocDock(markdownTocDockWidth(container.clientWidth))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const tocAvailable = tocItems.length > 0
  const tocDockable = tocDock !== null
  useLayoutEffect(
    () => onTocChange({ available: tocAvailable, dockable: tocDockable }),
    [tocAvailable, tocDockable, onTocChange]
  )
  useLayoutEffect(() => () => onTocChange(NO_TOC), [onTocChange])

  /** 按视口顶边所在的源码行重算当前标题 */
  const updateTocCurrent = useCallback((): void => {
    const container = containerRef.current
    if (!container) return
    const pin = tocPinRef.current
    if (pin?.scrollTop === container.scrollTop) return
    tocPinRef.current = null
    // 跳到标题时滚动位置会取整，差不到一像素的算已到顶
    setTocCurrent(markdownTocCurrent(tocLines, lineAtPos(linePoints(), container.scrollTop + 1)))
  }, [tocLines, linePoints])
  useLayoutEffect(() => updateTocCurrent(), [updateTocCurrent])

  // 页面尺寸一变（图片加载撑高、拖窗口换行）块的位置跟着变；视口上方撑高时，眼前的内容由浏览器的滚动锚定保持不动
  useEffect(() => {
    const bodyEl = bodyRef.current
    if (!bodyEl) return
    const ro = new ResizeObserver(() => {
      pointsRef.current = null
      updateTocCurrent()
    })
    ro.observe(bodyEl)
    return () => ro.disconnect()
  }, [updateTocCurrent])

  /** 点目录：标题滚到视口顶边并点亮，焦点还给正文（同点缩略图跳页） */
  const selectHeading = (index: number): void => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = posAtLine(linePoints(), tocLines[index])
    tocPinRef.current = { index, scrollTop: container.scrollTop }
    setTocCurrent(index)
    container.focus({ preventScroll: true })
  }

  /** 停靠的目录宽；没有停靠的目录时为 null（正文照常居中） */
  const dockWidth = toc && tocAvailable ? tocDock : null

  const onScroll = (): void => {
    const container = containerRef.current
    if (!container) return
    viewState.set('line', lineAtPos(linePoints(), container.scrollTop))
    updateTocCurrent()
  }

  const finder = useMemo(
    () => compileTextFind(query, { caseSensitive, wholeWord, regexp }),
    [query, caseSensitive, wholeWord, regexp]
  )

  const { closeFind: closeSession } = find
  const closeFind = useCallback(() => {
    closeSession()
    containerRef.current?.focus({ preventScroll: true })
  }, [closeSession])

  usePagedPreviewKeys({ active, rootRef, findOpen: open, openFind, closeFind })

  // 在页面文字上找、标出全部命中与当前命中；查询、选项、当前命中或正文变了即重找。
  // 新一轮查找（含切到预览时查找已开着）从视口顶边起并滚到首个命中，上一个 / 下一个滚到所选命中
  const { currentOf, claimReveal } = cursor
  useLayoutEffect(() => {
    const bodyEl = bodyRef.current
    const container = containerRef.current
    if (!open) indexRef.current = null
    if (!open || query === '' || !finder || !bodyEl || !container) {
      setFound(NO_MATCH)
      return
    }
    if (indexRef.current?.body !== body) {
      const blocks = collectFindBlocks(bodyEl)
      indexRef.current = {
        body,
        nodes: blocks.map((b) => b.nodes),
        index: buildMarkdownFindIndex(
          blocks.map((b) => ({ texts: b.nodes.map((n) => n.data), pre: b.pre }))
        )
      }
    }
    const { nodes, index } = indexRef.current
    let origin = startRef.current
    if (origin?.round !== round) {
      origin = { round, top: container.scrollTop }
      startRef.current = origin
    }
    const ranges = markdownFindSpans(index, finder).map(({ block, start, end }) => {
      const range = document.createRange()
      range.setStart(nodes[block][start[0]], start[1])
      range.setEnd(nodes[block][end[0]], end[1])
      return range
    })
    const current = currentOf(ranges.length, () =>
      firstRangeBelow(
        ranges,
        container.getBoundingClientRect().top - container.scrollTop + origin.top
      )
    )
    const { all, current: cur } = findHighlights()
    ranges.forEach((r, i) => (i === current ? cur : all).add(r))
    if (current >= 0 && claimReveal(origin)) scrollRangeToCenter(container, ranges[current])
    setFound((prev) =>
      prev.total === ranges.length && prev.current === current
        ? prev
        : { total: ranges.length, current }
    )
    return () => ranges.forEach((r, i) => (i === current ? cur : all).delete(r))
  }, [open, round, query, finder, currentOf, claimReveal, body])

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {open && (
        <FindBar
          {...find.bar}
          {...cursor.barOf(query, found.current, found.total)}
          invalidMessage={finder === null ? '无效的正则表达式' : null}
          onClose={closeFind}
        />
      )}
      {/* 可聚焦：点进正文后 Cmd+F / Esc 归本预览，PageUp / PageDown 原生滚动。
          停靠的目录宽交给版心让位（main.css「Markdown 预览的版心与目录」） */}
      <div
        ref={containerRef}
        tabIndex={-1}
        className="files-md-scroll min-h-0 flex-1 select-text overflow-y-auto bg-deepest outline-none"
        style={
          dockWidth === null
            ? undefined
            : ({ '--files-md-toc-w': `${dockWidth}px` } as React.CSSProperties)
        }
        onScroll={onScroll}
      >
        {dockWidth !== null && (
          <FilesMarkdownToc items={tocItems} current={tocCurrent} onSelect={selectHeading} />
        )}
        <div ref={bodyRef} className="files-md-preview prose prose-sm px-8 py-6">
          {body}
        </div>
      </div>
      {/* 抽屉里的目录：侧边没显示时悬停目录钮浮出（开合归 FilesTextEditor） */}
      {tocAvailable && (
        <FilesMarkdownTocDrawer
          body={containerRef}
          onHover={onTocDrawerHover}
          items={tocItems}
          current={tocCurrent}
          onSelect={selectHeading}
        />
      )}
    </div>
  )
}
