// 提交查找部件（toolbar-widgets §3）：表格右上浮层，样式抄 Console 的终端搜索框。
// 匹配计算是导出纯函数 findMatches（供测试）；结果写回 store.find，表格按 matches 渲染高亮；
// 上/下移动改 activeIdx 并把对应行 scrollIntoView。大小写 / 正则 / 「跳转时打开提交详情」
// 三个开关持久化到 viewPrefs。输入框内的 Enter / Esc 由本组件自理（GitPane 对输入控件让位）。
import { useEffect, useRef } from 'react'
import { BookOpen, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { UNCOMMITTED, type GitCommit } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'
import { cn } from '@renderer/lib/utils'

export interface FindOptions {
  caseSensitive: boolean
  regex: boolean
}

/** 非正则模式的特殊字符转义（照参考实现 findWidget.ts 的字符集）。 */
function escapeFindQuery(query: string): string {
  return query.replace(/[\\[\](){}|.*+?^$]/g, '\\$&')
}

/** 构造查找正则；query 为空或正则非法返回 null。 */
function buildFindRegExp(query: string, opts: FindOptions): RegExp | null {
  if (query === '') return null
  try {
    return new RegExp(opts.regex ? query : escapeFindQuery(query), opts.caseSensitive ? 'u' : 'ui')
  } catch {
    return null
  }
}

/**
 * 查找输入的错误文案：正则非法返回异常消息；会产生零长度匹配的正则（如 a*）
 * 会命中一切且无法高亮，同样视为错误（§3.3 零长度匹配防御）；合法返回 null。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 冻结契约：纯函数与组件同文件导出
export function getFindError(query: string, opts: FindOptions): string | null {
  if (query === '' || !opts.regex) return null
  let re: RegExp
  try {
    re = new RegExp(query, opts.caseSensitive ? 'u' : 'ui')
  } catch (e) {
    return e instanceof Error ? e.message : '无效的正则表达式'
  }
  if (re.test('')) return '不能使用会产生零长度匹配的正则表达式'
  return null
}

/**
 * 计算命中提交（按表格行序返回 hash 列表）。命中范围（§3.3 收敛到 DevCube 现有列）：
 * 提交消息 / 作者名 / 邮箱 / 完整 hash 前缀或 8 位缩写 / 本地分支名 / 远程分支名 /
 * tag 名 / stash selector。跳过未提交更改行；正则非法或产生零长度匹配时返回 []。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 冻结契约：纯函数与组件同文件导出
export function findMatches(commits: GitCommit[], query: string, opts: FindOptions): string[] {
  const re = buildFindRegExp(query, opts)
  if (re === null || re.test('')) return []
  // 只认正长度匹配：\b、前瞻等在真实文本上产生零长度匹配的正则不算命中——否则会泛滥高亮
  // 到几乎所有提交（对齐原实现：零长度匹配视为无效）。re 无 g 标志，exec 无状态、每次从头搜。
  const hit = (text: string): boolean => {
    const m = re.exec(text)
    return m !== null && m[0].length > 0
  }
  const matches: string[] = []
  for (const c of commits) {
    if (c.hash === UNCOMMITTED) continue // 未提交更改行不参与查找（§3.3）
    const hp = re.exec(c.hash)
    const hashHit =
      (hp !== null && hp.index === 0 && hp[0].length > 0) || hit(c.hash.substring(0, 8))
    if (
      hashHit ||
      hit(c.message) ||
      hit(c.author) ||
      hit(c.email) ||
      c.heads.some(hit) ||
      c.remotes.some((r) => hit(r.name)) ||
      c.tags.some((t) => hit(t.name)) ||
      (c.stash !== null && hit(c.stash.selector.substring(5)))
    ) {
      matches.push(c.hash)
    }
  }
  return matches
}

// 开关钮（Aa / .* / 详情联动）：激活态用选中行蓝底区分
const TOGGLE_BTN =
  'flex h-6 shrink-0 items-center justify-center rounded px-1 font-mono text-[11px] transition-colors'
const NAV_BTN =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)] disabled:pointer-events-none disabled:opacity-50'

/** 查找浮层：由集成者挂在表格容器（relative）内，find 为 null 或未打开时不渲染。 */
export function GitFindWidget({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const find = useGit((s) => gitState(s, projectPath).find)
  const commits = useGit((s) => gitState(s, projectPath).commits)
  const openDetailsOnJump = useGit((s) => s.viewPrefs.findOpenCommitDetailsView)
  const setFind = useGit((s) => s.setFind)
  const setViewPrefs = useGit((s) => s.setViewPrefs)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isOpen = find?.open ?? false
  const query = isOpen ? (find?.query ?? '') : ''
  const caseSensitive = find?.caseSensitive ?? false
  const regex = find?.regex ?? false

  /** 把命中行滚进视口：限定在本 Pane 的表格容器内查（多项目隐藏 Pane 可能有同 hash 行）。 */
  const scrollToHash = (hash: string): void => {
    const scope = rootRef.current?.parentElement ?? document
    scope.querySelector(`[data-hash="${CSS.escape(hash)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  /** 「跳转时打开提交详情」开着时联动打开当前匹配的详情（§3.6）。 */
  const openDetailsIfEnabled = (hash: string): void => {
    const store = useGit.getState()
    if (!store.viewPrefs.findOpenCommitDetailsView) return
    const st = gitState(store, projectPath)
    if (st.expanded?.hash === hash && st.expanded.compareWith === null) return
    const commit = st.commits.find((c) => c.hash === hash)
    void store.openDetails(projectPath, hash, commit?.stash ?? null)
  }

  // 打开即聚焦输入框
  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  // 查找计算：词 / 开关 / 提交数据任一变化后 200ms 防抖重算（§3.2、§3.7）。
  // 原当前匹配仍在则停留原位（不劫持滚动）；否则跳到第一个匹配并滚动 + 详情联动。
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      const store = useGit.getState()
      const f = gitState(store, projectPath).find
      if (!f || !f.open) return
      const matches = findMatches(gitState(store, projectPath).commits, f.query, {
        caseSensitive: f.caseSensitive,
        regex: f.regex
      })
      const prevActive = f.activeIdx >= 0 ? (f.matches[f.activeIdx] ?? null) : null
      let activeIdx = prevActive !== null ? matches.indexOf(prevActive) : -1
      const moved = activeIdx === -1
      if (moved) activeIdx = matches.length > 0 ? 0 : -1
      store.setFind(projectPath, { matches, activeIdx })
      if (moved && activeIdx >= 0) {
        scrollToHash(matches[activeIdx])
        openDetailsIfEnabled(matches[activeIdx])
      }
    }, 200)
    return () => clearTimeout(timer)
    // scrollToHash / openDetailsIfEnabled 每次渲染新建但仅用稳定引用，不进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, caseSensitive, regex, commits, projectPath])

  if (!find || !find.open) return null

  const matchCount = find.matches.length
  const error = getFindError(find.query, { caseSensitive, regex })

  /** 上/下一个匹配：回绕循环（§3.5），滚动 + 详情联动。 */
  const navigate = (dir: 1 | -1): void => {
    const store = useGit.getState()
    const f = gitState(store, projectPath).find
    if (!f || f.matches.length === 0) return
    const idx = f.activeIdx < 0 ? 0 : (f.activeIdx + dir + f.matches.length) % f.matches.length
    store.setFind(projectPath, { activeIdx: idx })
    scrollToHash(f.matches[idx])
    openDetailsIfEnabled(f.matches[idx])
  }

  /** 关闭：整体清空不保留搜索词（§3.1）。 */
  const close = (): void => setFind(projectPath, null)

  const toggleCase = (): void => {
    setFind(projectPath, { caseSensitive: !caseSensitive })
    void setViewPrefs({ findIsCaseSensitive: !caseSensitive })
  }
  const toggleRegex = (): void => {
    setFind(projectPath, { regex: !regex })
    void setViewPrefs({ findIsRegex: !regex })
  }
  const toggleOpenDetails = (): void => {
    const next = !openDetailsOnJump
    void setViewPrefs({ findOpenCommitDetailsView: next })
    // 打开开关的同时，若已有当前匹配则立即联动打开其详情（§3.6）
    const f = gitState(useGit.getState(), projectPath).find
    if (next && f && f.activeIdx >= 0) {
      const hash = f.matches[f.activeIdx]
      const commit = commits.find((c) => c.hash === hash)
      const store = useGit.getState()
      const exp = gitState(store, projectPath).expanded
      if (exp?.hash !== hash) void store.openDetails(projectPath, hash, commit?.stash ?? null)
    }
  }

  const countLabel =
    find.query === '' ? null : matchCount === 0 ? '无结果' : `${find.activeIdx + 1}/${matchCount}`

  return (
    <div
      ref={rootRef}
      className="absolute right-3 top-2 z-20 w-80 rounded-lg border border-[color:var(--border-input)] bg-panel px-1.5 py-1 shadow-xl"
    >
      <div className="flex items-center gap-1">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={find.query}
          onChange={(e) => setFind(projectPath, { query: e.target.value })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return // 中文输入法合成中：Enter 是确认候选，不导航
            if (e.key === 'Enter' || e.key === 'F3') {
              e.preventDefault()
              navigate(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              close()
            }
          }}
          placeholder="查找"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {countLabel !== null && !error && (
          <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {countLabel}
          </span>
        )}
        <button
          type="button"
          title="区分大小写"
          onClick={toggleCase}
          className={cn(
            TOGGLE_BTN,
            caseSensitive
              ? 'bg-[var(--selection-row)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
          )}
        >
          Aa
        </button>
        <button
          type="button"
          title="使用正则表达式"
          onClick={toggleRegex}
          className={cn(
            TOGGLE_BTN,
            regex
              ? 'bg-[var(--selection-row)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
          )}
        >
          .*
        </button>
        <button
          type="button"
          title="跳转时打开提交详情"
          onClick={toggleOpenDetails}
          className={cn(
            TOGGLE_BTN,
            'size-6 px-0',
            openDetailsOnJump
              ? 'bg-[var(--selection-row)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--bg-button-hover)] hover:text-[color:var(--fg-icon)]'
          )}
        >
          <BookOpen className="size-3.5" />
        </button>
        <button
          type="button"
          title="上一个匹配 (Shift+Enter)"
          disabled={matchCount === 0}
          onClick={() => navigate(-1)}
          className={NAV_BTN}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          title="下一个匹配 (Enter)"
          disabled={matchCount === 0}
          onClick={() => navigate(1)}
          className={NAV_BTN}
        >
          <ChevronDown className="size-4" />
        </button>
        <button type="button" title="关闭 (Esc)" onClick={close} className={NAV_BTN}>
          <X className="size-4" />
        </button>
      </div>
      {error !== null && (
        <div className="select-text px-0.5 pt-1 text-[11px] text-[color:var(--status-failed)]">
          {error}
        </div>
      )}
    </div>
  )
}
