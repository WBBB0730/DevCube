import { describe, expect, it } from 'vitest'
import {
  exportFileName,
  exportWriter,
  resultValueText,
  type InsertTarget
} from './data-source-export'
import type { ResultColumn, ResultValue } from './data-source-query'

const columns: ResultColumn[] = [
  { name: 'id', type: 'number' },
  { name: 'name', type: 'text' },
  { name: 'active', type: 'boolean' },
  { name: 'avatar', type: 'text' }
]

/** 没有生成列、没有总是自动生成的标识列的目标表。 */
function target(table: string): InsertTarget {
  return { table, generated: [], alwaysIdentity: [] }
}

function write(writer: ReturnType<typeof exportWriter>, rows: ResultValue[][]): string {
  return writer.head + rows.map(writer.row).join('') + writer.tail
}

describe('resultValueText', () => {
  it('NULL 为空，二进制写成 0x 开头的十六进制，文字原样（空串仍是空串）', () => {
    expect(resultValueText(null)).toBe('')
    expect(resultValueText({ hex: 'ff00' })).toBe('0xff00')
    expect(resultValueText('a\tb')).toBe('a\tb')
    expect(resultValueText('')).toBe('')
  })
})

describe('exportWriter · CSV', () => {
  it('开头写 BOM 与表头；CRLF 换行；含逗号、引号、换行的格子加引号', () => {
    const csv = write(exportWriter('csv', 'postgresql', columns, target('"t"')), [
      ['1', 'a,"b"\nc', 't', null],
      ['2', '', 'f', { hex: 'ff00' }]
    ])
    expect(csv).toBe('\uFEFFid,name,active,avatar\r\n1,"a,""b""\nc",t,\r\n2,,f,0xff00\r\n')
  })

  it('生成列照旧写（只有 SQL INSERT 不写）', () => {
    const csv = write(
      exportWriter('csv', 'postgresql', columns, { ...target('"t"'), generated: ['avatar'] }),
      [['1', 'a', 't', 'x']]
    )
    expect(csv).toBe('\uFEFFid,name,active,avatar\r\n1,a,t,x\r\n')
  })
})

describe('exportWriter · JSON', () => {
  it('数字原样写成数字（大整数不失真），布尔写成布尔，NULL 为 null，二进制为 0x 字符串', () => {
    const json = write(exportWriter('json', 'postgresql', columns, target('"t"')), [
      ['12345678901234567890', 'Ada', 't', { hex: 'ab' }],
      ['NaN', null, 'f', null]
    ])
    expect(json).toBe(
      '[\n  { "id": 12345678901234567890, "name": "Ada", "active": true, "avatar": "0xab" },\n' +
        '  { "id": "NaN", "name": null, "active": false, "avatar": null }\n]\n'
    )
  })

  it('没有行时是空数组', () => {
    expect(write(exportWriter('json', 'sqlite', columns, target('"t"')), [])).toBe('[]\n')
  })

  it('生成列照旧写（只有 SQL INSERT 不写）', () => {
    const json = write(
      exportWriter('json', 'sqlite', columns, { ...target('"t"'), generated: ['avatar'] }),
      [['1', 'a', 't', 'x']]
    )
    expect(json).toBe('[\n  { "id": 1, "name": "a", "active": true, "avatar": "x" }\n]\n')
  })
})

describe('exportWriter · SQL INSERT', () => {
  const row: ResultValue[] = ['1', "O'Brien \\ x", 't', { hex: 'ff' }]

  it('PostgreSQL：单引号写两遍，反斜杠原样；二进制写成 bytea', () => {
    expect(write(exportWriter('sql', 'postgresql', columns, target('"public"."t"')), [row])).toBe(
      `INSERT INTO "public"."t" ("id", "name", "active", "avatar") VALUES (1, 'O''Brien \\ x', TRUE, '\\xff'::bytea);\n`
    )
  })

  it('MySQL：反斜杠也写两遍，标识符用反引号；二进制写成 X 字面量', () => {
    expect(write(exportWriter('sql', 'mysql', columns, target('`shop`.`t`')), [row])).toBe(
      "INSERT INTO `shop`.`t` (`id`, `name`, `active`, `avatar`) VALUES (1, 'O''Brien \\\\ x', TRUE, X'FF');\n"
    )
  })

  it('生成列不写进列清单与值（按列名，不论位置），其余列照原来的次序', () => {
    const generated = exportWriter('sql', 'postgresql', columns, {
      ...target('"t"'),
      generated: ['name', 'avatar']
    })
    expect(write(generated, [row])).toBe(`INSERT INTO "t" ("id", "active") VALUES (1, TRUE);\n`)
  })

  it('PostgreSQL：写了总是自动生成的标识列时加 OVERRIDING SYSTEM VALUE，照原来的值写', () => {
    const identity = exportWriter('sql', 'postgresql', columns, {
      ...target('"t"'),
      generated: ['avatar'],
      alwaysIdentity: ['id']
    })
    expect(write(identity, [row, ['2', 'b', 'f', null]])).toBe(
      `INSERT INTO "t" ("id", "name", "active") OVERRIDING SYSTEM VALUE VALUES (1, 'O''Brien \\ x', TRUE);\n` +
        `INSERT INTO "t" ("id", "name", "active") OVERRIDING SYSTEM VALUE VALUES (2, 'b', FALSE);\n`
    )
  })

  it('没有总是自动生成的标识列，或它不在写的列里时不加', () => {
    expect(write(exportWriter('sql', 'postgresql', columns, target('"t"')), [row])).not.toContain(
      'OVERRIDING'
    )
    const notWritten = exportWriter('sql', 'postgresql', columns, {
      ...target('"t"'),
      alwaysIdentity: ['seq']
    })
    expect(write(notWritten, [row])).not.toContain('OVERRIDING')
  })

  it('NULL 写成 NULL；不像数字的数字列写成字符串', () => {
    expect(
      write(exportWriter('sql', 'sqlite', columns, target('"t"')), [['Infinity', null, null, null]])
    ).toBe(
      `INSERT INTO "t" ("id", "name", "active", "avatar") VALUES ('Infinity', NULL, NULL, NULL);\n`
    )
  })
})

describe('exportFileName', () => {
  it('表名加格式扩展名', () => {
    expect(exportFileName('orders', 'csv')).toBe('orders.csv')
    expect(exportFileName('订单 2024', 'sql')).toBe('订单 2024.sql')
  })

  it('路径分隔符替换成 _，不会指到下载目录之外或子目录', () => {
    expect(exportFileName('../a/b', 'json')).toBe('.._a_b.json')
    expect(exportFileName('a\\b', 'csv')).toBe('a_b.csv')
  })

  it('Windows 不能用的字符与控制字符替换成 _', () => {
    expect(exportFileName('a:b*c?d"e<f>g|h', 'csv')).toBe('a_b_c_d_e_f_g_h.csv')
    expect(exportFileName('a\tb\nc', 'csv')).toBe('a_b_c.csv')
  })

  it('Windows 保留设备名（不分大小写，含带扩展名的）在名字后加 _', () => {
    expect(exportFileName('CON', 'csv')).toBe('CON_.csv')
    expect(exportFileName('nul', 'json')).toBe('nul_.json')
    expect(exportFileName('Com1', 'sql')).toBe('Com1_.sql')
    expect(exportFileName('LPT9', 'csv')).toBe('LPT9_.csv')
    expect(exportFileName('com²', 'csv')).toBe('com²_.csv')
    expect(exportFileName('aux.backup', 'csv')).toBe('aux_.backup.csv')
    expect(exportFileName(' prn ', 'csv')).toBe('prn_.csv')
  })

  it('只是以保留名开头、或 COM0、COM10 这类不是保留名的照原样', () => {
    expect(exportFileName('console', 'csv')).toBe('console.csv')
    expect(exportFileName('com10', 'csv')).toBe('com10.csv')
    expect(exportFileName('COM0', 'csv')).toBe('COM0.csv')
    expect(exportFileName('lpt', 'csv')).toBe('lpt.csv')
    expect(exportFileName('nul_x', 'csv')).toBe('nul_x.csv')
  })

  it('处理后为空时用 result', () => {
    expect(exportFileName('', 'csv')).toBe('result.csv')
    expect(exportFileName('   ', 'sql')).toBe('result.sql')
  })
})
