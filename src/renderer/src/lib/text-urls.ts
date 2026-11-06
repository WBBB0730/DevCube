/**
 * 纯文字里的网址（Git 提交信息正文与 Files 编辑器共用）：交给 linkify-it（markdown-it 的自动链接）识别，
 * 引号、尖括号、成对的括号与结尾标点都按它的规则断开。只认写全了协议的 http / https，不认省略协议的域名与邮箱。
 */
import { LinkifyIt, REBuilder } from 'linkify-it'

/**
 * 按代码与中文文字放宽的两处识别片段（linkify-it 的 rebuilder 扩展点）：
 * - 网址前紧挨着什么都行，只是不接在字母数字后面：库默认只认空白与标点之后，`KEY=https://…`、`` `https://…` ``、
 *   「详见https://…」都会漏掉；
 * - 反引号也算分隔：网址里不会有（须转义），它是代码与 Markdown 行内代码的定界符，不能算进网址。
 */
class CodeTextREBuilder extends REBuilder {
  override get_text_separators(): RegExp {
    return (this.cache.text_separators ??= /[><｜`]/)
  }

  override get_schema_search(): RegExp {
    return (this.cache.schema_search ??= new RegExp(
      `(^|[^0-9A-Za-z_])(${this.get_schema_names().source})`,
      'ig'
    ))
  }
}

const linkify = new LinkifyIt({
  fuzzyLink: false,
  fuzzyEmail: false,
  rebuilder: new CodeTextREBuilder()
})
  .add('ftp:', null)
  .add('//', null)
  .add('mailto:', null)

/** 按出现顺序给出各网址在文字里的起止（`text.slice(from, to)` 即网址） */
export function findUrls(text: string): { from: number; to: number }[] {
  return (linkify.match(text) ?? []).map((m) => ({ from: m.index, to: m.lastIndex }))
}
