// Files Tab · Markdown 预览：react-markdown + GFM。原始 HTML 不渲染（库默认，天然防注入）；
// 相对路径图片解析到项目内后经 dc-media 协议流式读取（越界 / 非图片不渲染；服务器上的文件不解析，
// 相对图片不显示）；链接一律拦截默认跳转，http/https/mailto 交给系统浏览器，其余（锚点 / 相对链接）不动作。
// 正文可选中复制；Cmd+F 在渲染后的正文里查找（换算见 lib/files-markdown），查找会话与编辑态共用（切换不关、不清空），
// 高亮同 PPT 走 CSS Custom Highlight、不改页面。
// 阅读位置与编辑器共用「视口顶边所在的源码行」：块元素标着源码起始行（rehypeSourceLines），以块为对应点分段换算，
// 所以两态切换停在同一处内容；按文件重挂，换文件从头开始（docs/prd/files-tab.md「阅读位置」）。
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
import remarkGfm from 'remark-gfm'
import { isExternalLink } from '@shared/external-link'
import { buildFilesMediaUrl } from '@shared/files'
import { resolveWithinProject } from '@shared/files-path'
import { imageMimeOf } from '@shared/git'
import { findHighlights, scrollRangeToCenter } from '@renderer/lib/find-highlight'
import {
  buildMarkdownFindIndex,
  MARKDOWN_INLINE_TAGS,
  markdownFindSpans,
  rehypeSourceLines,
  type MarkdownFindIndexBlock
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
import { FilesLocalContext } from './files-local-context'
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
  return node instanceof Element && !MARKDOWN_INLINE_TAGS.has(node.localName)
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
    while (el !== body && MARKDOWN_INLINE_TAGS.has(el.localName)) el = el.parentElement!
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
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeSourceLines]

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
  viewState
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
      }
    }
  }, [path, projectRoot, local])

  // 正文只随内容与渲染组件重渲染：react-markdown 每次渲染都整篇重新解析，查找打字等无关的重渲染不能连带它
  const body = useMemo(
    () => (
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
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

  // 页面尺寸一变（图片加载撑高、拖窗口换行）块的位置跟着变；视口上方撑高时，眼前的内容由浏览器的滚动锚定保持不动
  useEffect(() => {
    const bodyEl = bodyRef.current
    if (!bodyEl) return
    const ro = new ResizeObserver(() => {
      pointsRef.current = null
    })
    ro.observe(bodyEl)
    return () => ro.disconnect()
  }, [])

  const rememberLine = (): void => {
    const container = containerRef.current
    if (container) viewState.set('line', lineAtPos(linePoints(), container.scrollTop))
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
      {/* 可聚焦：点进正文后 Cmd+F / Esc 归本预览，PageUp / PageDown 原生滚动 */}
      <div
        ref={containerRef}
        tabIndex={-1}
        className="min-h-0 flex-1 select-text overflow-y-auto bg-deepest outline-none"
        onScroll={rememberLine}
      >
        <div
          ref={bodyRef}
          className="files-md-preview prose prose-sm mx-auto max-w-[760px] px-8 py-6"
        >
          {body}
        </div>
      </div>
    </div>
  )
}
