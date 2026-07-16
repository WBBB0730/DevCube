# Files Tab 用 chokidar 递归监听驱动树与打开文件刷新

Files Tab 的文件树原先懒加载后永不失效，打开文件内容靠 2s 轮询 mtime，跟不上 Finder / Terminal / 外部编辑器的增删改。我们采用与 Git 工作区监听同栈的 **chokidar 递归监听项目根**（对齐 VS Code「打开文件夹即递归 watch」），尾沿防抖后推 `files:changed`；渲染端只重拉**已缓存目录**（对齐 IntelliJ VFS「未 getChildren 的目录不保证创建通知」），并在同一通道上同步当前打开文件（无脏则静默重载、有脏则冲突），从而退役定时轮询。监听侧排除 `.git` / `node_modules` 与 IDE 忽略名路径段以抑制事件风暴；树**展示**规则不变（仍可手动展开 `node_modules`，只是其内部变更不走实时通道）。
