# Windows 压缩入口用原生经典右键扩展，多选一次交付

「用 DevCube 压缩」（`docs/prd/compress.md`）要在资源管理器里对文件和文件夹生效，并且多选时把全部路径一次交给 DevCube。现有「在 DevCube 中打开」用的注册表命令动词做不到这一点：多选时 Windows 会按选中项各启动一次程序，每次只带一个路径（[Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/shell/context-menu-handlers)），DevCube 无从知道这一批是否到齐。

我们决定写一个小的原生 C++ 进程内 COM DLL，实现 `IExplorerCommand`，并以经典动词的方式注册：在 HKCU 的 `*\shell` 与 `Directory\shell` 下设 `ExplorerCommandHandler={CLSID}` 和 `MultiSelectModel=Player`，CLSID 的 `InprocServer32` 指向这个 DLL。资源管理器把整个选区作为一个 `IShellItemArray` 交给 `Invoke`；DLL 只启动一次 DevCube，在命令行上带 `--compress` 和全部路径，超过命令行长度上限时改为传一个清单文件。菜单项出现在 Windows 10 的右键菜单和 Windows 11 的「显示更多选项」里，与「在 DevCube 中打开」在同一处。Notepad++ 的经典菜单用的就是这种注册方式。

- **开关与注册**：同 ADR-0025，由设置「系统集成」里的开关增删 HKCU 注册，安装器不写；NSIS 真卸载时兜底清理。
- **DLL 放在固定的用户目录**：DLL 随应用分发，开启时复制到 `%LOCALAPPDATA%\<name>\shell` 再注册，文件名带内容指纹。资源管理器加载后会一直占着 DLL，这样应用升级和便携版的临时解压目录都不受影响；应用启动时若发现随包的 DLL 换了版本、或唤起命令变了，就把新 DLL 写成新文件、改指注册表，旧文件能删时再删。
- **唤起路径**：DLL 从注册表读取要启动的 exe。安装版是安装目录里的 exe；便携版是便携 exe 本身（`PORTABLE_EXECUTABLE_FILE`），不是运行时解压出来的临时 exe（它在应用退出时会被删除）。
- **分线**：每个 Release Edition 用各自的 CLSID 与菜单文案，正式版和 Beta 并装时互不覆盖（ADR-0012）。
- **构建**：源码入库，在 CI 的 Windows runner 上用 MSVC 编译，只出 x64（与 Windows 发布目标一致）。和应用本身一样暂不签名。

## Considered Options

- **注册表命令动词**（现有「打开」的做法）：多选时拆成多个进程，排除。
- **主进程攒批**：收到第一个路径后等一小段时间，把陆续到达的合成一批。靠计时猜，机器卡时会拆成两次，属于凑合，排除。
- **「发送到」快捷方式**：零原生代码，也能一次交付全部选中项；但入口要放在「发送到」子菜单里，产品上不接受。
- **Windows 11 一级菜单（同一个 DLL + 稀疏包）**：VS Code、Notepad++、WinRAR、Bandizip 都这样做。但稀疏包必须用目标机器信任的证书签名（[Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)）。DevCube 的 Windows 包目前没有签名；微软的 Artifact Signing 只对美国、加拿大的个人开发者开放（[Microsoft Learn](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)），只能另购 OV 证书。这一档暂不做。
- **DropTarget 动词 + 进程外 COM 本地服务器 exe**：同样能一次交付，但仍是原生代码，而且多一个常驻进程与跨进程注册，比进程内 DLL 复杂，排除。

## Consequences

- 仓库第一次有 Windows 原生代码，CI 需要 MSVC 工具链；开发和调试这个 DLL 只能在 Windows 上进行。
- 以后办了 Windows 签名，可以给同一个 `IExplorerCommand` 类再加稀疏包注册，升级到 Windows 11 一级菜单，DLL 本身不用重写。
- 未签名的代码在开启了智能应用控制的机器上会被拦截，但这种机器上未签名的 DevCube 本身就已经运行不了，DLL 不带来新的限制。
- Windows ARM64 的资源管理器是原生 ARM64 进程，加载不了 x64 DLL，那里没有这个入口。
- ADR-0025「Windows 右键菜单经 reg.exe 写命令动词」仍适用于「在 DevCube 中打开」；需要多选一次交付的入口改走本 ADR。
