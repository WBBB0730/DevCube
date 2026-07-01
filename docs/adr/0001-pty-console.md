# 运行控制台采用伪终端 (PTY) 而非管道

Run Session 的进程输出要正确呈现 dev server 常见的 ANSI 颜色、spinner、进度条与 `\r` 覆盖行，并支持向进程输入。因此用 `node-pty` 起进程、`xterm.js` 渲染，而不是 `child_process` 管道 + 自研 ANSI 解析。

## Considered Options

- **PTY（node-pty + xterm.js）**（选中）：进程连到伪终端，TTY 特性与交互输入天然可用，观感贴近 WebStorm 控制台。
- **管道（spawn + stdout/stderr）**：无原生依赖、最简单，但无 TTY——工具常关闭彩色、进度条渲染成一堆重复烂行、无法向进程输入。

## Consequences

- 引入原生模块 `node-pty`，需随 Electron 版本重建（已有 electron-builder 的 `install-app-deps` 覆盖这一步）。
- 前端依赖 `xterm.js` 作为终端渲染器。
