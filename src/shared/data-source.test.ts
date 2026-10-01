import { describe, expect, it } from 'vitest'
import {
  isPasswordRejected,
  dataSourceConnectionChanged,
  dataSourceFailureMessage,
  dataSourceTargetError,
  dataSourceTargetLabel,
  defaultDataSourceName,
  defaultDatabaseOf,
  isTlsUnsupported,
  parseDataSourceUrl,
  redisDatabaseError,
  sameDataSourceTarget,
  type DataSourceTarget,
  type SqlServerTarget
} from './data-source'

const pg = (partial: Partial<SqlServerTarget> = {}): DataSourceTarget => ({
  kind: 'postgresql',
  host: 'db.example.com',
  port: 5432,
  user: 'app',
  database: 'shop',
  sslMode: null,
  direct: false,
  ...partial
})

describe('dataSourceTargetLabel / defaultDataSourceName', () => {
  it('默认端口不写，非默认追加；有库名接在最后', () => {
    expect(dataSourceTargetLabel(pg())).toBe('app@db.example.com/shop')
    expect(dataSourceTargetLabel(pg({ port: 6543, user: '', database: '' }))).toBe(
      'db.example.com:6543'
    )
    expect(defaultDataSourceName(pg())).toBe('db.example.com/shop')
  })

  it('IPv6 地址带端口时加方括号', () => {
    expect(defaultDataSourceName(pg({ host: '::1', port: 5433, database: '' }))).toBe('[::1]:5433')
  })

  it('SQLite：说明是完整路径，默认名是文件名', () => {
    const target: DataSourceTarget = { kind: 'sqlite', file: '/Users/me/app/data/app.db' }
    expect(dataSourceTargetLabel(target)).toBe('/Users/me/app/data/app.db')
    expect(defaultDataSourceName({ kind: 'sqlite', file: 'C:\\data\\app.sqlite' })).toBe(
      'app.sqlite'
    )
  })
})

describe('sameDataSourceTarget', () => {
  it('地址大小写不敏感；加密与直连设置不参与比较', () => {
    expect(
      sameDataSourceTarget(pg(), pg({ host: 'DB.example.com', sslMode: 'require', direct: true }))
    ).toBe(true)
    expect(sameDataSourceTarget(pg(), pg({ database: 'other' }))).toBe(false)
    expect(sameDataSourceTarget(pg(), { ...pg(), kind: 'mysql' } as DataSourceTarget)).toBe(false)
  })

  it('SQLite 按文件路径比较', () => {
    expect(
      sameDataSourceTarget({ kind: 'sqlite', file: '/a.db' }, { kind: 'sqlite', file: '/a.db' })
    ).toBe(true)
    expect(sameDataSourceTarget({ kind: 'sqlite', file: '/a.db' }, pg())).toBe(false)
  })
})

describe('dataSourceConnectionChanged', () => {
  it('只改地址大小写不算；地址、端口、用户、库变了都算', () => {
    expect(dataSourceConnectionChanged(pg(), pg({ host: 'DB.example.com' }))).toBe(false)
    expect(dataSourceConnectionChanged(pg(), pg({ port: 6543 }))).toBe(true)
    expect(dataSourceConnectionChanged(pg(), pg({ user: 'admin' }))).toBe(true)
    expect(dataSourceConnectionChanged(pg(), pg({ database: 'other' }))).toBe(true)
  })

  it('加密要求与直连开关变了也算', () => {
    expect(dataSourceConnectionChanged(pg(), pg({ sslMode: 'require' }))).toBe(true)
    expect(dataSourceConnectionChanged(pg(), pg({ direct: true }))).toBe(true)
    const redis: Extract<DataSourceTarget, { kind: 'redis' }> = {
      kind: 'redis',
      host: 'cache',
      port: 6379,
      user: '',
      database: '',
      tls: false,
      direct: false
    }
    expect(dataSourceConnectionChanged(redis, { ...redis, tls: true })).toBe(true)
    expect(dataSourceConnectionChanged(redis, { ...redis })).toBe(false)
  })

  it('SQLite 按文件路径；换了类型即算', () => {
    const file: DataSourceTarget = { kind: 'sqlite', file: '/a.db' }
    expect(dataSourceConnectionChanged(file, { kind: 'sqlite', file: '/a.db' })).toBe(false)
    expect(dataSourceConnectionChanged(file, { kind: 'sqlite', file: '/b.db' })).toBe(true)
    expect(dataSourceConnectionChanged(file, pg())).toBe(true)
  })
})

describe('defaultDatabaseOf', () => {
  it('PostgreSQL 为连上后所在的库（没填默认库时也有）', () => {
    expect(defaultDatabaseOf(pg(), 'shop')).toBe('shop')
    expect(defaultDatabaseOf(pg({ database: '' }), 'app')).toBe('app')
  })

  it('MySQL / MariaDB 为填的默认库，没填时没有', () => {
    for (const kind of ['mysql', 'mariadb'] as const) {
      expect(defaultDatabaseOf({ ...pg(), kind } as DataSourceTarget, '')).toBe('shop')
      expect(defaultDatabaseOf({ ...pg({ database: '' }), kind } as DataSourceTarget, '')).toBe('')
    }
  })

  it('SQLite、Redis 用不到，为空串', () => {
    expect(defaultDatabaseOf({ kind: 'sqlite', file: '/a.db' }, '')).toBe('')
    const redis: DataSourceTarget = {
      kind: 'redis',
      host: 'cache',
      port: 6379,
      user: '',
      database: '2',
      tls: false,
      direct: false
    }
    expect(defaultDatabaseOf(redis, '')).toBe('')
  })
})

describe('dataSourceTargetError', () => {
  it('地址必填、不含空白；端口 1–65535', () => {
    expect(dataSourceTargetError(pg())).toBeNull()
    expect(dataSourceTargetError(pg({ host: '' }))).toBe('请填写地址')
    expect(dataSourceTargetError(pg({ host: 'a b' }))).toBe('地址格式不正确')
    expect(dataSourceTargetError(pg({ port: 0 }))).toBe('端口应为 1–65535 的整数')
    expect(dataSourceTargetError(pg({ port: Number.NaN }))).toBe('端口应为 1–65535 的整数')
  })

  it('Redis 的库编号是非负整数；SQLite 要选文件', () => {
    const redis: DataSourceTarget = {
      kind: 'redis',
      host: 'cache',
      port: 6379,
      user: '',
      database: '',
      tls: false,
      direct: false
    }
    expect(dataSourceTargetError({ ...redis, database: '2' })).toBeNull()
    expect(dataSourceTargetError({ ...redis, database: 'x' })).toBe('库编号应为非负整数')
    expect(dataSourceTargetError({ kind: 'sqlite', file: '' })).toBe('请选择数据库文件')
  })
})

describe('redisDatabaseError', () => {
  it('留空或非负整数可以提交，其余报错', () => {
    expect(redisDatabaseError('')).toBeNull()
    expect(redisDatabaseError('0')).toBeNull()
    expect(redisDatabaseError('15')).toBeNull()
    expect(redisDatabaseError('shop')).toBe('库编号应为非负整数')
    expect(redisDatabaseError('-1')).toBe('库编号应为非负整数')
    expect(redisDatabaseError(' 1')).toBe('库编号应为非负整数')
  })
})

describe('parseDataSourceUrl', () => {
  it('PostgreSQL：拆出地址、端口、用户、密码与库；缺省端口取 5432', () => {
    expect(parseDataSourceUrl('postgresql://app:s3cret@db.example.com:6543/shop')).toEqual({
      target: pg({ port: 6543 }),
      password: 's3cret'
    })
    expect(parseDataSourceUrl('  postgres://app@db.example.com/shop  ')).toEqual({
      target: pg(),
      password: null
    })
  })

  it('密码按 URL 编码解码', () => {
    expect(parseDataSourceUrl('postgres://app:p%40ss%2Fw@db.example.com/shop')).toMatchObject({
      password: 'p@ss/w'
    })
  })

  it('PostgreSQL 的 sslmode：prefer / allow 为默认档，no-verify 同 require，认不出报错', () => {
    const mode = (query: string): unknown => {
      const parsed = parseDataSourceUrl(`postgres://db.example.com/shop?${query}`)
      return 'error' in parsed ? parsed.error : (parsed.target as { sslMode: unknown }).sslMode
    }
    expect(mode('sslmode=prefer')).toBeNull()
    expect(mode('sslmode=allow')).toBeNull()
    expect(mode('sslmode=require')).toBe('require')
    expect(mode('sslmode=no-verify')).toBe('require')
    expect(mode('sslmode=verify-full')).toBe('verify-full')
    expect(mode('sslmode=disable')).toBe('disable')
    expect(mode('sslmode=bogus')).toBe('不支持的 sslmode：bogus')
  })

  it('MySQL：ssl-mode 按官方取值映射，大小写不敏感', () => {
    const mode = (query: string): unknown => {
      const parsed = parseDataSourceUrl(`mysql://root@localhost/app?${query}`)
      return 'error' in parsed ? parsed.error : (parsed.target as { sslMode: unknown }).sslMode
    }
    expect(mode('ssl-mode=REQUIRED')).toBe('require')
    expect(mode('ssl-mode=verify_identity')).toBe('verify-full')
    expect(mode('ssl-mode=PREFERRED')).toBeNull()
    expect(mode('ssl-mode=DISABLED')).toBe('disable')
    expect(mode('ssl-mode=nope')).toBe('不支持的 ssl-mode：nope')
    expect(mode('')).toBeNull()
  })

  it('MySQL 缺省端口 3306；MariaDB 单独成类型', () => {
    expect(parseDataSourceUrl('mariadb://root:pw@10.0.0.8')).toEqual({
      target: {
        kind: 'mariadb',
        host: '10.0.0.8',
        port: 3306,
        user: 'root',
        database: '',
        sslMode: null,
        direct: false
      },
      password: 'pw'
    })
  })

  it('Redis：rediss:// 即 TLS；路径是库编号', () => {
    expect(parseDataSourceUrl('rediss://default:tok@us1.upstash.io:6380/2')).toEqual({
      target: {
        kind: 'redis',
        host: 'us1.upstash.io',
        port: 6380,
        user: 'default',
        database: '2',
        tls: true,
        direct: false
      },
      password: 'tok'
    })
    expect(parseDataSourceUrl('redis://cache/x')).toEqual({ error: '库编号应为非负整数' })
  })

  it('IPv6 地址去掉方括号', () => {
    expect(parseDataSourceUrl('postgres://[::1]:5433/shop')).toMatchObject({
      target: { host: '::1', port: 5433 }
    })
  })

  it('认不出的连接串报错', () => {
    expect(parseDataSourceUrl('mongodb://localhost')).toHaveProperty('error')
    expect(parseDataSourceUrl('host=localhost dbname=shop')).toHaveProperty('error')
    expect(parseDataSourceUrl('postgres:///shop')).toEqual({ error: '连接串里没有地址' })
  })
})

describe('dataSourceFailureMessage', () => {
  it('网络错误写明连不上哪里；默认端口不写', () => {
    expect(
      dataSourceFailureMessage(pg(), { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })
    ).toBe('无法连接到 db.example.com：连接被拒绝')
    expect(dataSourceFailureMessage(pg({ port: 6543 }), { code: 'ENOTFOUND', message: 'x' })).toBe(
      '无法连接到 db.example.com:6543：找不到主机'
    )
  })

  it('服务器关掉了连接（mysql2 的 PROTOCOL_CONNECTION_LOST）给中文', () => {
    expect(
      dataSourceFailureMessage(pg({ kind: 'mysql', port: 3306 }), {
        code: 'PROTOCOL_CONNECTION_LOST',
        message: 'Connection lost: The server closed the connection.'
      })
    ).toBe('连接被服务器关闭')
  })

  it('其余照原话；SQLite 的常见错误给中文', () => {
    expect(
      dataSourceFailureMessage(pg(), { message: 'password authentication failed for user "app"' })
    ).toBe('password authentication failed for user "app"')
    expect(
      dataSourceFailureMessage(
        { kind: 'sqlite', file: '/a.db' },
        { code: 'SQLITE_NOTADB', message: 'file is not a database' }
      )
    ).toBe('不是 SQLite 数据库文件')
    expect(
      dataSourceFailureMessage(
        { kind: 'sqlite', file: '/a.db' },
        { code: 'SQLITE_BUSY', message: 'database is locked' }
      )
    ).toBe('数据库正被其他程序占用，请稍后重试')
  })
})

describe('isPasswordRejected', () => {
  it('按各数据库的错误码认出密码被拒', () => {
    expect(isPasswordRejected('postgresql', { code: '28P01', message: 'x' })).toBe(true)
    expect(
      isPasswordRejected('postgresql', {
        message: 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'
      })
    ).toBe(true)
    expect(isPasswordRejected('postgresql', { code: '3D000', message: 'no such db' })).toBe(false)
    expect(isPasswordRejected('mysql', { errno: 1045, message: 'Access denied' })).toBe(true)
    expect(isPasswordRejected('mariadb', { errno: 1049, message: 'Unknown database' })).toBe(false)
    expect(
      isPasswordRejected('redis', { message: 'WRONGPASS invalid username-password pair' })
    ).toBe(true)
    expect(isPasswordRejected('redis', { message: 'NOAUTH Authentication required.' })).toBe(true)
    expect(isPasswordRejected('sqlite', { message: 'x' })).toBe(false)
  })
})

describe('isTlsUnsupported', () => {
  it('认出服务器不支持加密的两种回答', () => {
    expect(
      isTlsUnsupported('postgresql', { message: 'The server does not support SSL connections' })
    ).toBe(true)
    const noSsl = {
      code: 'HANDSHAKE_NO_SSL_SUPPORT',
      message: 'Server does not support secure connection'
    }
    expect(isTlsUnsupported('mysql', noSsl)).toBe(true)
    expect(isTlsUnsupported('mariadb', noSsl)).toBe(true)
  })

  it('别的加密错误不算不支持', () => {
    const certError = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' }
    expect(isTlsUnsupported('postgresql', certError)).toBe(false)
    expect(isTlsUnsupported('mysql', certError)).toBe(false)
    expect(isTlsUnsupported('mysql', { code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(
      false
    )
  })

  it('只认各自驱动的回答', () => {
    expect(
      isTlsUnsupported('mysql', { message: 'The server does not support SSL connections' })
    ).toBe(false)
    expect(isTlsUnsupported('postgresql', { code: 'HANDSHAKE_NO_SSL_SUPPORT', message: 'x' })).toBe(
      false
    )
  })
})
