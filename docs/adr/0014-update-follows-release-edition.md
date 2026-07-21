# 应用内更新按 Release Edition 过滤，不用官方 beta 通道漏斗

正式版与 Beta 是双安装身份（ADR-0012），产品要求更新不跨线。electron-builder 文档里的 `channel=beta` 语义是「beta ∪ latest」，`allowPrerelease`  alone 也会让 Beta 吃到更新的正式包——都会破坏身份封闭。因此以 GitHub Release 为源、用 electron-updater 检查/下载，但在采纳候选前按当前 **Release Edition** 过滤：正式只收非 Pre-release，Beta 只收 Pre-release（必要时再核对制品身份）。不采用官方多 channel 漏斗作为主方案。

## Considered Options

- **按 Release Edition 过滤**（选中）：与双身份模型一致，行为可单测。
- **官方 channel 漏斗**：beta 用户也会收到正式版，与「不跨线」冲突。
- **只靠发版 semver 纪律**：空窗期仍可能串线，单独不够。
