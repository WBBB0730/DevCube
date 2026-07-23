# 用 @parcel/watcher 统一项目文件监听

chokidar 在 Windows 上对递归树逐目录挂 `fs.watch`，登记含大型依赖树的仓库时会拖垮主进程；macOS 因 FSEvents 显得「同样代码不卡」。改为与 VS Code 同栈的 **@parcel/watcher**（原生递归：FSEvents / ReadDirectoryChangesW / inotify，C++ 侧合并节流），并合并原 discovery / Files / Git 三套监听为**每项目一条订阅**。忽略策略不硬编码生态目录：`.git` 仅白名单元数据，工作区是否刷新仍经 `git check-ignore`；Files 只再跳过 IDE 默认忽略名路径段。有仓库时监听根取 **仓库根**（可宽于登记项目路径，以覆盖 `.git` 与 monorepo 同仓变更）；Files/discovery 仍只对落在该项目路径下的事件入队。Git 写动作期间（含 1500ms 余震）整条订阅静音，完成后由动作路径主动推刷新。
