import { describe, expect, it } from 'vitest'
import {
  canonicalUncHost,
  copyablePath,
  canonicalWslPath,
  linuxToWslPath,
  wslDistroOf,
  wslToLinuxPath
} from './wsl-path'

describe('canonicalWslPath', () => {
  it('两种前缀、不分大小写，统一成 wsl.localhost 并保留原分隔符', () => {
    expect(canonicalWslPath('\\\\wsl$\\Ubuntu\\home\\me')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me'
    )
    expect(canonicalWslPath('\\\\WSL.LOCALHOST\\Ubuntu')).toBe('\\\\wsl.localhost\\Ubuntu')
    expect(canonicalWslPath('//wsl$/Ubuntu/home')).toBe('//wsl.localhost/Ubuntu/home')
  })

  it('非 WSL 路径原样返回', () => {
    expect(canonicalWslPath('C:\\code\\web')).toBe('C:\\code\\web')
    expect(canonicalWslPath('\\\\server\\share')).toBe('\\\\server\\share')
    expect(canonicalWslPath('\\\\wsl$x\\share')).toBe('\\\\wsl$x\\share')
    expect(canonicalWslPath('/home/me')).toBe('/home/me')
  })
})

describe('canonicalUncHost', () => {
  it('WSL 两种写法归一，其余转小写', () => {
    expect(canonicalUncHost('wsl$')).toBe('wsl.localhost')
    expect(canonicalUncHost('WSL.localhost')).toBe('wsl.localhost')
    expect(canonicalUncHost('FileServer')).toBe('fileserver')
  })
})

describe('wslDistroOf', () => {
  it('两种前缀、两种分隔符都认，取第一段', () => {
    expect(wslDistroOf('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('Ubuntu')
    expect(wslDistroOf('\\\\WSL$\\Debian')).toBe('Debian')
    expect(wslDistroOf('//wsl.localhost/Ubuntu-22.04/home')).toBe('Ubuntu-22.04')
  })

  it('不是 WSL 路径为 null', () => {
    expect(wslDistroOf('C:\\code\\web')).toBeNull()
    expect(wslDistroOf('\\\\server\\share')).toBeNull()
    expect(wslDistroOf('\\\\wsl.localhost')).toBeNull()
    expect(wslDistroOf('server:abc')).toBeNull()
  })
})

describe('wslToLinuxPath / linuxToWslPath', () => {
  it('前缀映射，两种前缀与分隔符都认', () => {
    expect(wslToLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\web')).toEqual({
      distro: 'Ubuntu',
      path: '/home/me/web'
    })
    expect(wslToLinuxPath('//wsl.localhost/Ubuntu/home/me/')).toEqual({
      distro: 'Ubuntu',
      path: '/home/me'
    })
    expect(wslToLinuxPath('\\\\wsl$\\Ubuntu')).toEqual({ distro: 'Ubuntu', path: '/' })
    expect(wslToLinuxPath('C:\\code')).toBeNull()
    expect(linuxToWslPath('Ubuntu', '/home/me/web')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\web'
    )
    expect(linuxToWslPath('Ubuntu', '/')).toBe('\\\\wsl.localhost\\Ubuntu')
  })

  it('NTFS 不允许的字符与私有区字符互转（同 WSL）', () => {
    const linux = '/home/me/a:b?c\\d|e'
    const windows = linuxToWslPath('Ubuntu', linux)
    expect(windows).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\a\uF03Ab\uF03Fc\uF05Cd\uF07Ce')
    expect(wslToLinuxPath(windows)).toEqual({ distro: 'Ubuntu', path: linux })
  })

  it('不是转义产物的私有区字符原样保留', () => {
    expect(wslToLinuxPath('//wsl.localhost/Ubuntu/x\uF041')?.path).toBe('/x\uF041')
  })
})

describe('copyablePath', () => {
  it('WSL 路径复制成 Linux 路径，其余原样', () => {
    expect(copyablePath('//wsl.localhost/Ubuntu/home/me/web/src/a.ts')).toBe(
      '/home/me/web/src/a.ts'
    )
    expect(copyablePath('\\\\wsl.localhost\\Ubuntu\\home\\me\\web/src/a.ts')).toBe(
      '/home/me/web/src/a.ts'
    )
    expect(copyablePath('C:/code/web/a.ts')).toBe('C:/code/web/a.ts')
  })
})
