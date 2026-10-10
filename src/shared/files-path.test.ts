import { describe, expect, it } from 'vitest'
import {
  childPathPrefix,
  isAbsolutePath,
  isLogicalRoot,
  joinLogicalPath,
  lastPathSegment,
  logicalParentPath,
  normalizePath,
  remapPathPrefix,
  resolveWithinProject
} from './files-path'

describe('normalizePath', () => {
  it('折叠 . 与 ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  })

  it('UNC 路径保留 //主机/共享 根，.. 不越过它', () => {
    expect(normalizePath('\\\\server\\share\\a\\b')).toBe('//server/share/a/b')
    expect(normalizePath('//server/share/a/../b/')).toBe('//server/share/b')
    expect(normalizePath('\\\\server\\share\\..\\..\\x')).toBe('//server/share/x')
    expect(normalizePath('\\\\server\\share')).toBe('//server/share')
    expect(normalizePath('//server/share/')).toBe('//server/share')
  })

  it('UNC 主机名统一写法：WSL 两种前缀归一为 wsl.localhost，其余转小写', () => {
    expect(normalizePath('\\\\wsl$\\Ubuntu\\home\\me')).toBe('//wsl.localhost/Ubuntu/home/me')
    expect(normalizePath('\\\\WSL.LocalHost\\Ubuntu\\home')).toBe('//wsl.localhost/Ubuntu/home')
    expect(normalizePath('\\\\Server\\Share')).toBe('//server/Share')
  })

  it('规范化结果再规范化不变', () => {
    for (const p of ['//wsl.localhost/Ubuntu/home/me', 'C:/a', '/a', 'a/b']) {
      expect(normalizePath(p)).toBe(p)
    }
  })
})

describe('isAbsolutePath / isLogicalRoot', () => {
  it('POSIX 根、盘符与 UNC 都是绝对路径', () => {
    expect(isAbsolutePath('/a')).toBe(true)
    expect(isAbsolutePath('C:\\a')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share')).toBe(true)
    expect(isAbsolutePath('//server/share')).toBe(true)
    expect(isAbsolutePath('src/a.ts')).toBe(false)
  })

  it('三种根', () => {
    expect(isLogicalRoot('/')).toBe(true)
    expect(isLogicalRoot('C:/')).toBe(true)
    expect(isLogicalRoot('//wsl.localhost/Ubuntu')).toBe(true)
    expect(isLogicalRoot('//wsl.localhost/Ubuntu/home')).toBe(false)
    expect(isLogicalRoot('/a')).toBe(false)
    expect(isLogicalRoot('a')).toBe(false)
  })
})

describe('childPathPrefix / joinLogicalPath / logicalParentPath', () => {
  it('根以 / 结尾时不重复补斜杠', () => {
    expect(childPathPrefix('/proj')).toBe('/proj/')
    expect(childPathPrefix('/')).toBe('/')
    expect(childPathPrefix('C:/')).toBe('C:/')
    expect(joinLogicalPath('/', 'etc')).toBe('/etc')
    expect(joinLogicalPath('/etc', 'nginx')).toBe('/etc/nginx')
  })

  it('拼接不规范化：服务器上的文件名可以含反斜杠', () => {
    expect(joinLogicalPath('/srv', 'a\\b')).toBe('/srv/a\\b')
  })

  it('所在目录：落到根时保留根的斜杠', () => {
    expect(logicalParentPath('/etc/nginx')).toBe('/etc')
    expect(logicalParentPath('/etc')).toBe('/')
    expect(logicalParentPath('/')).toBe('/')
    expect(logicalParentPath('C:/x')).toBe('C:/')
  })

  it('UNC：所在目录不越过 //主机/共享', () => {
    expect(childPathPrefix('//wsl.localhost/Ubuntu')).toBe('//wsl.localhost/Ubuntu/')
    expect(logicalParentPath('//wsl.localhost/Ubuntu/home/me')).toBe('//wsl.localhost/Ubuntu/home')
    expect(logicalParentPath('//wsl.localhost/Ubuntu/home')).toBe('//wsl.localhost/Ubuntu')
    expect(logicalParentPath('//wsl.localhost/Ubuntu')).toBe('//wsl.localhost/Ubuntu')
  })
})

describe('lastPathSegment', () => {
  it('兼容两种分隔符与末尾分隔符', () => {
    expect(lastPathSegment('/a/b/c')).toBe('c')
    expect(lastPathSegment('/a/b/c/')).toBe('c')
    expect(lastPathSegment('C:\\a\\b')).toBe('b')
  })
})

describe('remapPathPrefix', () => {
  it('命中自身与后代时替换前缀', () => {
    expect(remapPathPrefix('/p/a', '/p/a', '/p/b')).toBe('/p/b')
    expect(remapPathPrefix('/p/a/x/y', '/p/a', '/p/b')).toBe('/p/b/x/y')
  })

  it('同名前缀但非路径边界不误伤', () => {
    expect(remapPathPrefix('/p/ab/x', '/p/a', '/p/b')).toBe('/p/ab/x')
  })

  it('无关路径原样返回', () => {
    expect(remapPathPrefix('/q/c', '/p/a', '/p/b')).toBe('/q/c')
  })
})

describe('resolveWithinProject', () => {
  const root = '/proj'

  it('接受项目根自身', () => {
    expect(resolveWithinProject(root, root)).toBe('/proj')
    expect(resolveWithinProject(root, '.')).toBe('/proj')
  })

  it('接受根下相对路径', () => {
    expect(resolveWithinProject(root, 'src/a.ts')).toBe('/proj/src/a.ts')
  })

  it('拒绝 .. 穿越', () => {
    expect(resolveWithinProject(root, '../outside')).toBeNull()
    expect(resolveWithinProject(root, 'a/../../outside')).toBeNull()
  })

  it('拒绝根外绝对路径', () => {
    expect(resolveWithinProject(root, '/other/file')).toBeNull()
  })

  it('UNC 项目根：接受根下路径，拒绝穿越与其他发行版', () => {
    const wsl = '\\\\wsl.localhost\\Ubuntu\\home\\me\\web'
    expect(resolveWithinProject(wsl, 'src/a.ts')).toBe(
      '//wsl.localhost/Ubuntu/home/me/web/src/a.ts'
    )
    expect(resolveWithinProject(wsl, '\\\\wsl$\\Ubuntu\\home\\me\\web\\b')).toBe(
      '//wsl.localhost/Ubuntu/home/me/web/b'
    )
    expect(resolveWithinProject(wsl, '../other')).toBeNull()
    expect(resolveWithinProject(wsl, '//wsl.localhost/Debian/home/me/web/a')).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(resolveWithinProject('', 'a')).toBeNull()
    expect(resolveWithinProject(root, '')).toBeNull()
  })
})
