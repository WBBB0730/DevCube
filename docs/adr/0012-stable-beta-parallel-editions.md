# 正式版与 Beta 使用不同安装身份、可并行安装

需要同时分发正式版与 beta，且两者可装在同一台机器上互不影响。因此用不同的 `appId` / 显示名 / 图标区分安装身份（`com.wbbb.devcube` 与 `com.wbbb.devcube.beta`），本地用户数据随之隔离；而不是共用同一 `appId`、仅靠版本通道或 GitHub Pre-release 区分。

## Considered Options

- **双安装身份**（选中）：并行安装、Dock/开始菜单可辨、beta 写坏数据也不影响正式版。
- **同一 appId + 更新通道**：安装上互相覆盖，无法并行使用，内测会碰到正式版数据。
