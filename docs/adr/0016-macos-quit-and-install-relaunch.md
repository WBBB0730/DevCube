# macOS 更新安装走卸监听 + before-quit-for-update

自定义 `before-quit`（`preventDefault` + 异步清理）与 Squirrel.Mac 的 `quitAndInstall` 冲突：会装上更新但不自动重开。决定在清理完成后、调用 `quitAndInstall` 前卸掉会拦截退出的监听，改挂 `before-quit-for-update` 并 `app.exit(0)`，且用 `setImmediate` 把安装调用移出 `before-quit` 栈——与 electron-builder#8997 确认可行的主流修法一致。
