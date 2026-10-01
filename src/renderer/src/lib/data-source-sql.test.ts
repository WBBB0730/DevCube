import { describe, expect, it } from 'vitest'
import { codemirrorDialect, formatSql } from './data-source-sql'

describe('codemirrorDialect', () => {
  it('MySQL / MariaDB 把字符串里的反斜杠当转义符，其余不当', () => {
    expect(codemirrorDialect('mysql').spec.backslashEscapes).toBe(true)
    expect(codemirrorDialect('mariadb').spec.backslashEscapes).toBe(true)
    expect(codemirrorDialect('postgresql').spec.backslashEscapes).toBeFalsy()
    expect(codemirrorDialect('sqlite').spec.backslashEscapes).toBeFalsy()
  })

  it('其余照 lang-sql 自带的方言（井号注释、反引号标识符）', () => {
    expect(codemirrorDialect('mysql').spec).toMatchObject({
      hashComments: true,
      identifierQuotes: '`'
    })
  })
})

describe('formatSql', () => {
  it('认得运行配置的参数 ${…}，原样保留', () => {
    const formatted = formatSql(
      'select * from users where id=${id} and name = ${ user name }',
      'postgresql'
    )
    expect(formatted).toContain('${id}')
    expect(formatted).toContain('${ user name }')
  })

  it('各方言都认，方言自带的参数写法照旧', () => {
    expect(formatSql('select * from t where a = ${a} and b = $1', 'postgresql')).toContain('$1')
    expect(formatSql('select * from t where a = ${a} and b = ?', 'mysql')).toContain('${a}')
    expect(formatSql('select * from t where a = ${a}', 'mariadb')).toContain('${a}')
    expect(formatSql('select * from t where a = ${a} and b = :b', 'sqlite')).toContain(':b')
  })

  it('字符串里的 ${…} 照旧是字符串', () => {
    expect(formatSql("select '${a}' as x", 'postgresql')).toContain("'${a}'")
  })

  it('写得不对的语句抛出', () => {
    expect(() => formatSql('select (', 'postgresql')).toThrow()
  })
})
