/**
 * 焦点在树 / 列表上时打字转进它顶上的输入框（Files 树顶的筛选与「前往路径」等）：
 * 可打印字符接在后面、退格删一个，并把焦点交给输入框；Esc 清空（焦点留在原处）。
 * 反过来，框里按 Esc 离开输入框、焦点交还树 / 列表（先清空；见 BarInput 的 escapeFocusRef）。
 */

/** 一次按键对输入的改动：改成 query，或清空 */
export type TypeToInputEdit = { kind: 'set'; query: string } | { kind: 'clear' }

/** 按键 → 对输入的改动；null = 不归它管（方向键、带 ⌘ / Ctrl / ⌥ 的快捷键等留给树自己） */
export function typeToInputEdit(
  query: string,
  key: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>
): TypeToInputEdit | null {
  // 只有空白时 Esc 不算有内容，不清
  if (key.key === 'Escape') return query.trim() ? { kind: 'clear' } : null
  if (key.key === 'Backspace') return query ? { kind: 'set', query: query.slice(0, -1) } : null
  if (key.key.length === 1 && !key.metaKey && !key.ctrlKey && !key.altKey) {
    return { kind: 'set', query: query + key.key }
  }
  return null
}

/**
 * 树 / 列表的 onKeyDown 里调用：按 typeToInputEdit 改输入（事件来自输入框本身时不管）。
 * onClear 单独给：清空常要连带别的（如退出筛选后定位回当前文件）；清空时只调它、不调 onChange，
 * 它要自己把值清空（如 `() => { setDraft(''); apply('') }`）。
 */
export function typeToInput(
  e: React.KeyboardEvent,
  {
    query,
    inputRef,
    onChange,
    onClear
  }: {
    query: string
    inputRef: React.RefObject<HTMLInputElement | null>
    onChange: (query: string) => void
    onClear: () => void
  }
): void {
  if (e.target instanceof HTMLInputElement) return
  const edit = typeToInputEdit(query, e)
  if (edit === null) return
  e.preventDefault()
  if (edit.kind === 'clear') {
    onClear()
    return
  }
  onChange(edit.query)
  inputRef.current?.focus()
}
