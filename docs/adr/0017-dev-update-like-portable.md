# 未包装开发更新策略同便携

要在本地验证更新 UI，且官方支持用 `forceDevUpdateConfig` + 根目录 `dev-app-update.yml` 测检查流。决定：未包装的 `dev` 与 Windows Portable 一样只检查、顶栏/「立即更新」打开 GitHub Release，不静默下载安装；包装后仍解析为 `dev` 的平台（如 Linux）本轮继续不启用检查。
