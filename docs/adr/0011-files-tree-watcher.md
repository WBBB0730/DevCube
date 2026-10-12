# Files Tab 用文件监听驱动树与打开文件刷新

Files Tab 的文件树与打开文件要跟上 Finder / Terminal / 外部编辑器的增删改，且不靠定时轮询 mtime。我们采用对项目根的**递归文件监听**（对齐 VS Code「打开文件夹即递归 watch」），尾沿防抖后推 `files:changed`；渲染端只重拉**已缓存目录**（对齐 IntelliJ VFS「未 getChildren 的目录不保证创建通知」），并在同一通道上同步当前打开文件（无脏则静默重载、有脏则冲突）。树**展示**规则不变（仍可手动展开 `node_modules` 等）。

监听实现与 Git / discovery 的合并栈见 ADR-0021（@parcel/watcher）。

监听通知不能当作唯一来源：macOS 的 fseventsd 实测会把部分订阅的事件压住数小时（订阅仍在、不报错也不标「需重扫」，睡眠唤醒后才补发），只靠通知的树会一直停在旧状态。因此另加兜底（对齐 IntelliJ「切回 IDE 时同步外部改动」）：切回 Files Tab、窗口回到前台、点树顶「刷新」时主动重读已缓存目录，并作废该根的文件名索引、重拉 Git 标记。仍不做定时轮询。
