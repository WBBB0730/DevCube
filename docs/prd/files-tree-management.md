# Files 文件树基础管理（新建 / 重命名 / 删除）

## Problem Statement

Files Tab 只能浏览和编辑既有文件：想加一个文件、改个名、删掉废弃文件，都得切去 Finder 或 Terminal，一个「以项目为维度」的工作台在最基础的文件操作上断档。

## Solution

文件树支持右键菜单：目录（含树空白区 = 项目根）可新建文件 / 新建文件夹，非根条目可重命名 / 删除。新建与重命名走弹窗输入，删除弹确认并移入系统回收站（可恢复）。操作后树自动刷新，打开中的文件跟随重命名 / 删除联动。

## User Stories

1. As a 开发者, I want 右键目录新建文件, so that 不离开面板就能补一个配置或文档
2. As a 开发者, I want 右键目录新建文件夹, so that 能就地搭出目录结构
3. As a 开发者, I want 在树空白区右键新建, so that 项目根下的新建不用先找到某个目录行
4. As a 开发者, I want 新建文件后自动打开它, so that 能立即开始编辑
5. As a 开发者, I want 重命名文件或文件夹, so that 改名不用切换工具
6. As a 开发者, I want 重命名弹窗预选中主文件名（不含扩展名）, so that 直接打字就能替换（WebStorm 手感）
7. As a 开发者, I want 删除前有确认弹窗, so that 不会误删
8. As a 开发者, I want 删除进系统回收站, so that 删错了还能找回来
9. As a 开发者, I want 重命名当前打开的文件（或其上层目录）后编辑器不断开, so that 正文、面包屑与最近列表都指向新路径
10. As a 开发者, I want 删除当前打开的文件后正文立即清空, so that 不会停留在幽灵内容上
11. As a 开发者, I want 重名或非法名称时弹窗内就地报错, so that 我能改完名字直接重试
12. As a 开发者, I want 项目根不可重命名 / 删除, so that 不会从面板里把项目本身干掉
13. As a 开发者, I want 操作后文件树立即刷新, so that 不用等 watcher 或手动折腾

## Implementation Decisions

- 主进程新增三条 Files IPC（新建 / 重命名 / 回收站删除），全部走既有项目内路径越界校验；新建用独占标志原子创建（重名即失败）；重命名限就地改名（不跨目录移动）、大小写不敏感文件系统上放行仅改大小写；删除用 Electron `shell.trashItem`，不提供永久删除。
- 名称校验只拦单段硬约束（空、`.`、`..`、含分隔符），其余交文件系统报错，错误文案在弹窗内就地展示。
- 右键菜单复用 Base UI 受控 ContextMenu + 鼠标点虚拟 anchor（同 Git 图谱菜单模式，非行级 Trigger）；文件行仅重命名 / 删除，目录行含新建两项，空白区（项目根）仅新建两项。
- 弹窗外壳对齐 FilesPane 既有磁盘冲突弹窗；确认回调抛错时弹窗保持打开。
- 联动：重命名前先落未保存编辑；展开集 / 选中 / 最近列表按前缀重映射（shared 纯函数）；打开文件受影响时强制按新路径重开，再统一从磁盘刷新树（避免刷新把旧路径判「已消失」误清）。删除时撤掉挂起的自动保存计时器，防止把刚删的文件写回。
- 领域边界更新：CONTEXT.md 的 Files Tab 从「不做文件管理」放宽为支持新建 / 重命名 / 删除；复制 / 移动仍不做。

## Testing Decisions

- 纯函数 `remapPathPrefix`（重命名前缀重映射）配 vitest（边界：自身 / 后代 / 同名非边界前缀 / 无关路径），与 shared/files-path 既有测试同文件。
- 主进程文件操作与 UI 接线不做单测（依赖真实文件系统与 Electron shell），人工回归。

## Out of Scope

- 复制 / 移动（含拖拽移动）。
- 多选批量操作。
- 内联重命名（树内就地编辑输入框，VS Code 式）——本版走弹窗。
- 永久删除（Shift+Delete）。

## Further Notes

树刷新吃 ADR-0011 的 watcher 通道 + 操作后主动 `refreshFromDisk`，两路幂等。
