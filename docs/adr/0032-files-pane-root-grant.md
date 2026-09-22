# Files 面板从「项目根」泛化为「根授权表」，预览窗口复用同一组件

Preview Window（`docs/prd/file-preview-window.md`）要在任意文件夹上跑 Files Tab 的整套面板，而主进程的目录列举 / 读写 / 媒体协议 / 瓦片 / 文件监听原先都按「已登记 Project 根」放行。我们不为预览另写一套面板或 IPC，而是：

- **主进程**改为一张根授权表（`files-roots`）：已登记项目根天然在表内；每个预览窗口按窗口 id 登记当前根、「上一级」时替换、关窗撤销。所有 Files IPC 与 `dc-media://` 协议只查这张表，路径穿越校验规则不变。
- **渲染层**把 `FilesPane` 的「项目路径」参数泛化为「根路径」，宿主差异只通过一个 `host` 开关表达（是否可上翻根、是否显示「添加为项目」、状态是否落盘、树菜单是否含终端、初始文件）。预览窗口用同一渲染入口，主进程以 URL 查询串标记「预览模式 + 初始文件 + 初始根」，「上一级」换根时按根重挂面板。
- IPC handler 注册与主窗口绑定拆开（`registerIpcHandlers` / `bindMainWindow`）：冷启动只带文件时只开预览窗口、不建主窗口，handler 仍须就绪。

## Considered Options

- **把文件所在目录登记成临时 Project**：改动最小，但语义错位（Downloads 成了带 Git Tab / 探测脚本 / 索引 / 监听的项目）、污染项目列表，且要给 Project 引入新状态。
- **为预览另写精简面板**：与 Files Tab 的看图 / PDF / 编辑 / 树能力重复，两处漂移。
