import type { ITheme } from '@xterm/xterm'

// 背景/前景/光标取自 WebStorm Darcula；ANSI 16 色取自 JetBrains 终端真实 Console Colors 调色板。见 DESIGN.md。
export const xtermTheme: ITheme = {
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
}
