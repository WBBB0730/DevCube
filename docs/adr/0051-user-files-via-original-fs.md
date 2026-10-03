# 主进程读写用户的文件一律用 original-fs

Electron 为了让应用读自己打包的 `app.asar`，改装了主进程（以及其中的 worker 线程）里 Node 的 `fs`：路径里只要出现 `.asar`，就当成归档往里读——`.asar` 文件被当成文件夹，名字以 `.asar` 结尾的真文件夹反而会被当成损坏的归档报错。这对用户磁盘上的文件是错的：在 **Files Tab** 里打开一个项目的打包产物目录，`app.asar` 显示成能展开的文件夹；压缩时取消「排除被 Git 忽略的文件」直接报错（`ENOTDIR … app.asar/…`）。

我们决定：主进程里凡是读写**用户的文件**，一律用 Electron 内置的 `original-fs`——不带这层改装的原版 `fs`（Electron 文档「Treating an asar archive as a normal file」）。读写**应用自身**的文件（打包在 asar 里的代码与资源）仍用普通 `fs`。已实测：主进程与 worker 线程里，改装过的 `fs` 把 `app.asar` 认作文件夹，`original-fs` 认作文件。

目前按此处理的：文件树与文件读写（`files.ts`）、媒体预览协议、大图瓦片缓存、External Open 的路径判定、登记项目、服务器文件的本地一侧（上传下载）、压缩的清单扫描与写包。

## Considered Options

- **`original-fs`（选中）**：Electron 官方给出的做法，按模块选择，应用自身照常读 asar。
- **`process.noAsar = true`**：全局关掉 asar 支持，应用自己的代码与资源就读不了，排除。
- **只在出错处特判 `.asar`**：同一类问题散落在每个读用户文件的地方，修一处漏一处，排除。

## Consequences

- 新增读写用户文件的主进程代码，要从 `original-fs` 导入，而不是 `node:fs`。
- `original-fs` 只存在于 Electron 里：打包时声明为外部模块（electron.vite.config.ts），单测里映射到 `node:fs`（vitest.config.ts）。
- 第三方库内部自己读文件的（如 file-type、image-size 按路径读）仍走改装过的 `fs`；它们只用来认文件类型，对 `.asar` 文件失败时按「未知类型」处理，结果正确。
