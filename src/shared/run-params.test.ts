import { describe, expect, it } from 'vitest'
import {
  fillRunConfigParams,
  fillRunParams,
  RUN_PARAM_SOURCE,
  runConfigParamNames,
  runParamNames
} from './run-params'
import type { CommandRunConfig, DataSourceRunConfig, RemoteRunConfig } from './types'

const local: CommandRunConfig = {
  id: 'c1',
  kind: 'command',
  projectPath: '/p',
  name: '部署',
  command: 'pnpm deploy --tag ${{tag}}',
  cwd: 'packages/${{ 包 }}',
  env: { API_TOKEN: '${{token}}', TAG: 'v${{tag}}' }
}

describe('runParamNames', () => {
  it('只认 ${{名称}}：去重，按第一次出现的顺序', () => {
    expect(
      runParamNames([
        'SELECT * FROM t WHERE a = ${{id}} AND b > ${{min}} OR a = ${{id}};\nDELETE FROM u WHERE c = ${{名称}}'
      ])
    ).toEqual(['id', 'min', '名称'])
  })

  it('写在引号、注释里也算；名称去掉首尾空白', () => {
    expect(runParamNames(["SELECT '${{ tag }}' -- ${{note}}\nSELECT ${{tag}}"])).toEqual([
      'tag',
      'note'
    ])
  })

  it('几处文字合起来去重，按先后', () => {
    expect(runParamNames(['echo ${{a}}', '${{b}}/${{a}}', '${{c}}'])).toEqual(['a', 'b', 'c'])
  })

  it('shell 变量与 Go 模板不算', () => {
    expect(
      runParamNames([
        'docker run -v ${PWD}:/app -e HOME=$HOME ${IMAGE:-node} && echo $A$B $PATH:$HOME',
        "docker ps --format '{{.Names}}' && date +%Y%m%d"
      ])
    ).toEqual([])
  })

  it('不认 ${名称}、? 与 :名称，PostgreSQL 的 :: 不受影响', () => {
    expect(runParamNames(['SELECT ${id}, ?::int, :name, created::date FROM t'])).toEqual([])
  })

  it('空的、跨行的、带花括号的不算参数', () => {
    expect(runParamNames(['${{}}, ${{  }}, ${{a\nb}}, ${{{x}}}, ${{a{b}}, $x, {{y}}'])).toEqual([])
  })

  it('Redis 命令同样认', () => {
    expect(runParamNames(['GET user:${{id}}\nEXPIRE user:${{id}} ${{ttl}}'])).toEqual(['id', 'ttl'])
  })
})

describe('runConfigParamNames', () => {
  it('本机的配置依次认命令、工作目录、各环境变量的值，跨处去重', () => {
    expect(runConfigParamNames(local)).toEqual(['tag', '包', 'token'])
  })

  it('服务器上的配置同样认；环境变量名不认', () => {
    const remote: RemoteRunConfig = {
      id: 'r1',
      kind: 'remote',
      serverId: 's1',
      name: '日志',
      command: 'tail -f ${{file}}',
      cwd: '~/logs/${{day}}',
      env: { '${{key}}': '1' }
    }
    expect(runConfigParamNames(remote)).toEqual(['file', 'day'])
  })

  it('没有工作目录、环境变量时只认命令', () => {
    expect(
      runConfigParamNames({
        id: 'c2',
        kind: 'command',
        projectPath: '/p',
        name: 'test',
        command: 'pnpm vitest ${{file}}'
      })
    ).toEqual(['file'])
  })

  it('数据源上的配置取内容', () => {
    const sql: DataSourceRunConfig = {
      id: 'd1',
      kind: 'dataSource',
      dataSourceId: 'db',
      name: '清理',
      script: "DELETE FROM sessions WHERE created < now() - interval '${{days}} days'",
      database: '${{库}}'
    }
    expect(runConfigParamNames(sql)).toEqual(['days'])
  })
})

describe('fillRunParams', () => {
  it('按文字原样替换，写在哪里都换（含引号里），同名的都换', () => {
    expect(
      fillRunParams("SELECT * FROM t WHERE a = ${{id}} AND b = '${{ id }}-${{tag}}'", {
        id: '42',
        tag: 'x y'
      })
    ).toBe("SELECT * FROM t WHERE a = 42 AND b = '42-x y'")
  })

  it('值不加引号、不转义；空值即换成空', () => {
    expect(fillRunParams('git commit -m ${{m}}\necho ${{e}}', { m: '"a b"', e: '' })).toBe(
      'git commit -m "a b"\necho '
    )
  })

  it('没给值的参数与不算参数的原样留着', () => {
    expect(fillRunParams('echo ${{a}} ${{b}} ${{}} ${HOME}', { a: '1', HOME: 'x' })).toBe(
      'echo 1 ${{b}} ${{}} ${HOME}'
    )
  })

  it('只换一遍：填的值里的 ${{…}} 不再展开', () => {
    expect(fillRunParams('echo ${{a}}', { a: '${{b}}', b: '2' })).toBe('echo ${{b}}')
  })

  it('只认自己的键，不认原型上的', () => {
    expect(fillRunParams('echo ${{constructor}}', {})).toBe('echo ${{constructor}}')
  })
})

describe('fillRunConfigParams', () => {
  it('换命令、工作目录与各环境变量的值；环境变量名与其余字段不动', () => {
    expect(fillRunConfigParams(local, { tag: '1.2.0', 包: 'web', token: 'abc' })).toEqual({
      ...local,
      command: 'pnpm deploy --tag 1.2.0',
      cwd: 'packages/web',
      env: { API_TOKEN: 'abc', TAG: 'v1.2.0' }
    })
  })

  it('没有工作目录、环境变量的照旧没有', () => {
    const remote: RemoteRunConfig = {
      id: 'r1',
      kind: 'remote',
      serverId: 's1',
      name: '重启',
      command: 'systemctl restart ${{unit}}'
    }
    const filled = fillRunConfigParams(remote, { unit: 'nginx' })
    expect(filled).toEqual({ ...remote, command: 'systemctl restart nginx' })
    expect('cwd' in filled).toBe(false)
    expect('env' in filled).toBe(false)
  })
})

describe('RUN_PARAM_SOURCE', () => {
  it('与认参数的规则一致：整个 ${{…}} 算一个，不跨行、不含花括号', () => {
    const pattern = new RegExp(`^${RUN_PARAM_SOURCE}$`)
    expect(pattern.test('${{id}}')).toBe(true)
    expect(pattern.test('${{ user name }}')).toBe(true)
    expect(pattern.test('${{}}')).toBe(true)
    expect(pattern.test('${{a\nb}}')).toBe(false)
    expect(pattern.test('${{a{b}}}')).toBe(false)
    expect(pattern.test('${id}')).toBe(false)
  })
})
