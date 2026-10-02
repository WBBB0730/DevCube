import { describe, expect, it } from 'vitest'
import { paramEditOnBackspace, paramEditOnType, type ParamEdit } from './run-param-autoclose'

/** `|` 标出光标；照编辑做完后再标出光标。不归规则管时照常输入（退格照常删一个字）。 */
function type(marked: string, ...chars: string[]): string {
  let text = marked.replace('|', '')
  let pos = marked.indexOf('|')
  for (const ch of chars) {
    const edit: ParamEdit =
      ch === '\b'
        ? (paramEditOnBackspace(text, pos) ?? {
            from: pos - 1,
            to: pos,
            insert: '',
            cursor: pos - 1
          })
        : (paramEditOnType(text, pos, ch) ?? { from: pos, to: pos, insert: ch, cursor: pos + 1 })
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
    pos = edit.cursor
  }
  return `${text.slice(0, pos)}|${text.slice(pos)}`
}

describe('输入 ${{ 时补上 }}', () => {
  it('补上 }}，光标停在中间', () => {
    expect(type('echo |', '$', '{', '{')).toBe('echo ${{|}}')
    expect(type('echo | --tag', '$', '{', '{')).toBe('echo ${{|}} --tag')
  })

  it('引号里、括号前同样补', () => {
    expect(type("where a = '|'", '$', '{', '{')).toBe("where a = '${{|}}'")
    expect(type('git commit -m "|"', '$', '{', '{')).toBe('git commit -m "${{|}}"')
    expect(type('cp a{,|}', '$', '{', '{')).toBe('cp a{,${{|}}}')
  })

  it('光标后紧跟字母、数字时不补', () => {
    expect(type('echo |tag', '$', '{', '{')).toBe('echo ${{|tag')
    expect(type('echo |标签', '$', '{', '{')).toBe('echo ${{|标签')
    expect(type('echo |1', '$', '{', '{')).toBe('echo ${{|1')
  })

  it('$ 之后的第一个 { 照原样输入，不补', () => {
    expect(paramEditOnType('echo $', 6, '{')).toEqual({ from: 6, to: 6, insert: '{', cursor: 7 })
    expect(type('echo |', '$', '{')).toBe('echo ${|')
  })

  it('不是 $ 之后的 { 不归它管', () => {
    expect(paramEditOnType('echo ', 5, '{')).toBeNull()
    expect(paramEditOnType('echo {', 6, '{')).toBeNull()
    expect(paramEditOnType('echo ${{', 8, '{')).toBeNull()
  })
})

describe('在参数里输入 } 时跳过已有的 }', () => {
  it('照习惯打完整个参数，不多出括号', () => {
    expect(type('echo |', ...'${{tag}}')).toBe('echo ${{tag}}|')
    expect(type("where a = '|'", ...'${{ id }}')).toBe("where a = '${{ id }}|'")
  })

  it('参数之外的 } 照常输入', () => {
    expect(paramEditOnType('echo ${{tag}}}', 13, '}')).toBeNull()
    expect(paramEditOnType('echo {a}', 7, '}')).toBeNull()
    expect(paramEditOnType('echo ${a}', 8, '}')).toBeNull()
    expect(paramEditOnType('echo ${{tag}}', 13, '}')).toBeNull()
  })
})

describe('刚补完按退格，连同 }} 一起删掉', () => {
  it('回到 ${', () => {
    expect(type('echo |', '$', '{', '{', '\b')).toBe('echo ${|')
    expect(type('echo |', '$', '{', '{', '\b', '\b')).toBe('echo $|')
  })

  it('中间有名称时照常删', () => {
    expect(paramEditOnBackspace('echo ${{a}}', 9)).toBeNull()
    expect(type('echo ${{a|}}', '\b')).toBe('echo ${{|}}')
  })

  it('不是空参数时不归它管', () => {
    expect(paramEditOnBackspace('echo {{}}', 7)).toBeNull()
    expect(paramEditOnBackspace('echo ${{}', 8)).toBeNull()
  })
})
