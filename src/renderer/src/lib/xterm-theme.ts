import type { ITheme } from '@xterm/xterm'
import type { ThemeMode } from '@shared/theme'

// 背景/前景/光标取自 WebStorm 编辑器配色方案，ANSI 16 色取自其 CONSOLE_*_OUTPUT 调色板
// （深色 = Darcula，浅色 = Default 基方案）。见 DESIGN.md。
export const xtermThemes: Record<ThemeMode, ITheme> = {
  dark: {
    background: '#1e1f22',
    foreground: '#bcbec4',
    cursor: '#ced0d6',
    cursorAccent: '#1e1f22',
    selectionBackground: '#2d436e',
    black: '#000000',
    red: '#f0524f',
    green: '#5c962c',
    yellow: '#a68a0d',
    blue: '#3993d4',
    magenta: '#a771bf',
    cyan: '#00a3a3',
    white: '#808080',
    brightBlack: '#595959',
    brightRed: '#ff4050',
    brightGreen: '#4fc414',
    brightYellow: '#e5bf00',
    brightBlue: '#1fb0ff',
    brightMagenta: '#ed7eed',
    brightCyan: '#00e5e5',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#ffffff',
    foreground: '#000000',
    cursor: '#000000',
    cursorAccent: '#ffffff',
    // 浅色取 .icls 的 SELECTION_BACKGROUND（深色那颗是历史手取的 UI 选中蓝，未对齐 .icls）
    selectionBackground: '#a6d2ff',
    black: '#000000',
    red: '#ce0505',
    green: '#067d17',
    yellow: '#b28c00',
    blue: '#063fdb',
    magenta: '#b309b3',
    cyan: '#028e8e',
    // 白 / 亮白在白底上对比度很低，这是 JetBrains 浅色的原样取值，未作可读性调整
    white: '#929292',
    brightBlack: '#656565',
    brightRed: '#ff1616',
    brightGreen: '#16b42c',
    brightYellow: '#ecc32c',
    brightBlue: '#2d61f0',
    brightMagenta: '#e617e6',
    brightCyan: '#15c1c1',
    brightWhite: '#c9c9c9'
  }
}
