/**
 * 预览查找（⌘F）共用的文字匹配：表格与 Markdown 预览同一套规则（PPT 的匹配走 pptx-renderer 自带的，只借这里的
 * 偏移换算）。选项有区分大小写、全词；与编辑态共用查找栏的预览（Markdown、CSV）另有正则，标志同编辑器（u + m，
 * ^ / $ 认行首行尾）。全词的词界同编辑器：前后紧挨字母、数字、下划线（含中文）即不算，查询自身两端不是词字符时那一端
 * 不要求。
 */

/** `regexp` 缺省为否 */
export type TextFindOptions = { caseSensitive: boolean; wholeWord: boolean; regexp?: boolean }

const WORD_START = /^[\p{L}\p{N}_]/u
const WORD_END = /[\p{L}\p{N}_]$/u

/** `text` 里 [from, to) 两端是否落在词界上 */
function atWordBoundary(text: string, from: number, to: number): boolean {
  const before = text.slice(Math.max(0, from - 2), from)
  const after = text.slice(to, to + 2)
  const match = text.slice(from, to)
  const startOk = !WORD_END.test(before) || !WORD_START.test(match)
  const endOk = !WORD_START.test(after) || !WORD_END.test(match)
  return startOk && endOk
}

/**
 * 编出一个查找器：返回一段文字里的全部命中区间 [起, 止)，自左向右、互不重叠；查询为空则恒无命中，正则写错为 null。
 * 不分大小写走正则的忽略大小写，区间按原文计，不受大小写转换改变字串长度的影响。空命中（如 `a*` 在别处）标不出来，跳过。
 */
export function compileTextFind(
  query: string,
  { caseSensitive, wholeWord, regexp = false }: TextFindOptions
): ((text: string) => [number, number][]) | null {
  if (query === '') return () => []
  let re: RegExp
  try {
    re = new RegExp(
      regexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'gmu' + (caseSensitive ? '' : 'i')
    )
  } catch {
    return null
  }
  return (text) => {
    const found: [number, number][] = []
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const to = m.index + m[0].length
      if (to > m.index && (!wholeWord || atWordBoundary(text, m.index, to)))
        found.push([m.index, to])
      // 空命中或不在词界上：从下一个字起再找，与它重叠的候选仍有机会。按整字前进：落在 emoji 等两个码元的字中间，
      // 正则（u 标志）会退回字头、再得到同一个命中，就停不下来了
      else re.lastIndex = m.index + ((text.codePointAt(m.index) ?? 0) > 0xffff ? 2 : 1)
    }
    return found
  }
}

/**
 * 依次相连的文字节点里，整体偏移落在哪个节点的第几个字：返回 [节点下标, 节点内偏移]，越界为 null。
 * 起点落在节点边界时取后一个节点的开头，终点取前一个节点的结尾，免得区间吃进空节点。
 */
export function locateTextOffset(
  texts: readonly string[],
  offset: number,
  isEnd: boolean
): [number, number] | null {
  let acc = 0
  for (let i = 0; i < texts.length; i++) {
    const len = texts[i].length
    if (isEnd ? offset <= acc + len : offset < acc + len) return [i, offset - acc]
    acc += len
  }
  return null
}
