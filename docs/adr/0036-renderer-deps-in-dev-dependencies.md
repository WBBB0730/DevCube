# dependencies 只放主进程与预加载运行时引用的包，界面层专用的依赖放 devDependencies

electron-vite 编译界面层时，代码引用到的包一律编进产物，不看它写在 package.json 哪一栏；主进程与预加载相反，`dependencies` 里的包保持外部引用，运行时从安装包里的 node_modules 加载。electron-builder 只把 `dependencies` 及其依赖闭包原样打进 app.asar。所以界面层专用的库写在 `dependencies`，安装包里就会多出一份永远用不到的副本：v1.10.0 的 app.asar 有 241 MB，其中应用代码只有 11 MB；pdfjs-dist 还经由可选依赖带进了 25 MB 的原生 @napi-rs/canvas，每次发版都要跟着签名、公证、压缩。因此 `dependencies` 只放主进程、预加载在运行时引用的包，界面层专用的一律放 `devDependencies`。这是 electron-vite 文档的建议，react / react-dom 从一开始就是这么放的，后来加的界面层库没有跟上。

调整时把 52 个界面层库挪进了 `devDependencies`，锁文件里所有包的解析结果不变。编译产物逐字节相同；主进程引用的 18 个包的依赖闭包（103 个包）在安装包里的路径与内容也逐字节相同。macOS 安装包由 572 MB 降到 336 MB，app.asar 由 241 MB 降到 30 MB。

## Considered Options

- **保持原样**：功能上等价，但安装包大了一倍多，发版时的签名、公证、压缩以及用户下载更新都跟着变慢。
- **在 electron-builder 的 `files` 里逐个写排除规则**：要跟着依赖变化手工维护，漏写不会报错；依赖放在哪一栏本身就是 electron-builder 判断打不打包的依据，没必要另起一套。

## Consequences

- 新增依赖按「运行时谁引用它」决定放哪一栏。放错的代价不对称：界面层的库放进 `dependencies`，只是安装包变大；主进程的库放进 `devDependencies`，electron-vite 会把它编进主进程产物，纯 JS 库还能工作，原生模块、自带二进制或按路径找自身文件的库（node-pty、sharp、ripgrep 等）打包后会在运行时出错。
- 核对办法：编译产物 `out/main`、`out/preload` 里保留的外部引用，就是 `dependencies` 该有的全部内容。
- 打包后仍需按路径读取的依赖文件（PDF.js 字体表与 wasm、表格解析 wasm）经 extraResources 复制到 resources/，不从 app.asar 里的 node_modules 读，与依赖放在哪一栏无关（ADR-0030、ADR-0034）。
