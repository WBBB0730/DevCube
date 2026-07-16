# 每项目工作台 Tab 现场落盘：激活 Tab、当前项目与选中、Terminal 壳；Run Session 仍不持久

切换项目与重启后应回到「刚才在看哪」。我们决定把**当前项目**、**左树选中**、**每项目激活 Tab**，以及 **Terminal** 的壳（稳定 id、名字、顺序）写入 ADR-0002 的同一份集中 JSON，**变更即写**。**Run Session** Tab 与输出仍不跨冷启动恢复（不引入空闲占位会话）。Terminal **进程与输出**仍不持久：栏上先恢复壳，**第一次激活才 spawn**；关 Tab 或 shell 自退出与落盘集合保持同步。热重载时 **活会话优先**，落盘只补名字/顺序与无活进程的壳。冷启动恢复当前项目时 **更新 `lastOpenedAt`**。激活键失效则继续走 ADR-0005，不专清历史键。

## Considered Options

- **只持久化激活 Tab**：改动小，但重启后仍要重选项目、重开终端，现场不完整。
- **连 Run Session 空 Tab 一起恢复（曾议）**：需 `idle` 会话或「壳 ≠ Session」双轨；空控制台收益低，放弃。
- **Terminal 元数据 + 工作台选中/激活（选中）**：补齐最痛的现场，且不碰 Run Session 不持久的边界。
- **退出才写盘**：实现省事，崩溃易丢最近操作；与 `filesUi` 不一致，故变更即写。

## Consequences

- `PersistedState` 增加工作台字段；移除项目时级联清理。
- ADR-0003：Terminal 由「纯内存」修订为「壳可持久、进程/输出不持久」。
- ADR-0002：Run Session 仍不持久；同库可存工作台 UI 状态。
- `openTerminal`（或等价）须支持预定 id，以便懒 spawn 与激活键对齐。
