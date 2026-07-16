## Problem Statement

开发者在多个 **Project** 之间切换、或重启 DevCube 之后，右侧会丢「刚才在看哪」：当前项目、左树选中、激活的 Tab，以及开过的 **Terminal**（名字与顺序）都不在了。进程内切项目尚能靠内存记住激活 Tab，但一重载或冷启动就要从默认激活（ADR-0005）重来；终端则连壳都没有，得重新 `+` / Cmd+T。Files / Git 的部分面板偏好已经按项目落盘，工作台「Tab 现场」却没有，体感断裂。

## Solution

把每项目的工作台 Tab 现场落入集中配置（ADR-0002），变更即写：

1. **当前项目 + 左树选中**：冷启动回到上次的 **Project** 与配置行（或项目行）选中。
2. **每项目激活 Tab**：切项目 / 重启后仍打开上次那个 Tab（键仍有效时）。
3. **Terminal 壳**：记住每个项目的终端 id、名字、顺序；栏上先恢复壳，**第一次激活该 Tab 才起 shell**（无历史输出）。
4. **Run Session Tab 不恢复**：进程与输出仍不持久化；重启后只有当时仍活着的会话（热重载）或用户再次运行才会出现运行 Tab。

## User Stories

1. 作为开发者，我想重启后仍停在上次的 **Project**，以便不用从左树再点一次。
2. 作为开发者，我想重启后左树仍高亮上次选中的配置（或项目行），以便选中态与右侧一致可预期。
3. 作为开发者，我想若上次选中的配置已被删除，则静默回落为选中该项目行，以便不报错、不留幽灵选中。
4. 作为开发者，我想重启后每个项目仍激活上次的 Tab（Git / Files / 当时仍有效的会话键 / Terminal），以便回到工作现场。
5. 作为开发者，我想激活键若指向已不存在的 Run Session 或 Terminal，则按 ADR-0005 解析默认激活，以便失效记忆不卡死。
6. 作为开发者，我想进程内切换项目时仍保持各项目自己的激活 Tab，以便和现在一样，只是重启后也不丢。
7. 作为开发者，我想我开过的 **Terminal** Tab 在重启后仍出现在栏上（名字、顺序不变），以便不用重新建终端。
8. 作为开发者，我想重启后的 Terminal 是空 shell（无上次输出），以便不强行持久化缓冲。
9. 作为开发者，我想未点开的 Terminal 壳不立刻占进程，只有第一次激活才 spawn，以便项目多、终端多时启动仍轻。
10. 作为开发者，我想若冷启动时激活的就是某个 Terminal，则进入该项目后立刻激活并 spawn，以便「恢复激活」不是死 Tab。
11. 作为开发者，我想双击改的终端名跨重启保留，以便不用每次重命名。
12. 作为开发者，我想拖拽重排的终端顺序跨重启保留，以便栏序稳定。
13. 作为开发者，我想关闭 Terminal Tab 后落盘集合也删掉它，以便栏与盘一致。
14. 作为开发者，我想 Terminal 的 shell 自行退出后 Tab 关闭且落盘也删，以便与现在「自退出即关 Tab」一致、不留幽灵壳。
15. 作为开发者，我不想重启后自动出现空的 Run Session Tab，以便不引入「从未跑过的会话」概念、也不假装恢复输出。
16. 作为开发者，我想热重载时主进程里还活着的 Terminal / Run Session 继续接上（含输出），以便开发时不丢现场。
17. 作为开发者，我想热重载时落盘只补名字、顺序，以及「盘上有、主进程没有」的 Terminal 壳，以便活会话优先于磁盘快照。
18. 作为开发者，我想冷启动恢复当前项目时更新该项目的 `lastOpenedAt`，以便「打开时间」排序把刚恢复的项目视为打开过。
19. 作为开发者，我想激活 Tab、改名、重排、开关终端、切项目、改选中都会立刻落盘，以便崩溃也不只丢「退出那一瞬间」之前的状态。
20. 作为开发者，我想移除项目时其工作台 Tab 现场（激活键、Terminal 壳等）一并清除，以便不留幽灵。
21. 作为开发者，我想首次使用或老档案没有这些字段时行为与现在一致（无当前项目占位 / ADR-0005 默认 / 无终端壳），以便升级平滑。
22. 作为开发者，我想 `Ctrl+Tab` 循环、Cmd+W、Cmd+T 等快捷键在恢复后的栏上仍按现有规则工作，以便不用学新键位。

## Implementation Decisions

- **存储**：扩写集中 `PersistedState`（ADR-0002），与 `filesUi` 并列。建议形状（实现可微调字段名，语义固定）：
  - 全局：`currentProjectPath: string | null`、`selectedKey: string | null`
  - 每项目：`activeTabByProject: Record<projectPath, string | null>`
  - 每项目终端壳列表：`terminalsByProject: Record<projectPath, { id, name }[]>`（数组序 = Tab 序；`id` 即会话键，如 `terminal:<uuid>`，跨重启稳定）
- **写盘时机**：上述任一变更即写（对齐 `filesUi`），不单等退出。
- **冷启动 hydrate**：读盘 → 恢复 `currentProjectPath` / `selectedKey` / `activeTabByProject` / 终端壳；对恢复的当前项目调用既有 `touchProject`（更新 `lastOpenedAt`）；`selectedKey` 若已无对应配置则置 `null`（项目行）。
- **激活解析**：继续用既有 `resolveActiveTabKey`（合法 `stored` 优先；否则 ADR-0005）。不因本特性改默认规则；不主动清历史里指向已消失 Run Session 的激活键（下次点 Tab 会覆写）。
- **Terminal 生命周期**：
  - 新建：分配稳定 id、写入壳列表、spawn、激活并落盘。
  - 改名 / 重排：只改壳列表并落盘。
  - 关闭或 shell 自退出：主进程弃会话 → 渲染端移除 Tab → 壳列表删除并落盘。
  - 懒 spawn：壳可先存在于渲染端（及落盘）；主进程尚无 PTY 时，**第一次激活**该键再 `openTerminal`（需支持「用已有 id 起壳」，避免每次新 UUID 对不上激活键）。
- **Run Session**：不写盘、不复活空 Tab；主进程会话模型不引入 `idle`。栏上运行 Tab 仍仅来自活着的 / 已退出未关的会话（与现在相同，仅跨冷启动不保留）。
- **热重载对账**：**活会话优先**——`getSessions` / `getTerminals` 接主进程；落盘终端壳用于恢复名字与顺序，并补「仅盘上有」的未 spawn 壳；不以盘覆盖活进程的 key/输出。
- **模块**：
  - 主进程配置存储：读写新字段；移除项目时级联清该路径下工作台字段。
  - 主进程 runner：`openTerminal` 可接受预定 id（或等价「ensureTerminal(id)」）；列表 API 仍只返回已 spawn 的。
  - 渲染 store：`init` hydrate + 对账；`activateTab` / `newTerminal` / 改名 / 重排 / 关闭路径触发落盘；切项目恢复激活。
  - 既有 `tab-activation` 纯函数可继续用；若抽「壳 ∪ 活终端」合并序，保持可单测。
- **IPC**：增补 get/set（或 patch）工作台状态的调用；Terminal 打开签名扩展以携带 id。具体通道名实现时定，与现有 files UI IPC 风格对齐。
- **ADR**：见 ADR-0008；并修订 ADR-0003（Terminal 元数据可持久）、ADR-0002（同库增工作台字段，Run Session 仍不持久）。

## Testing Decisions

好测试：只测纯函数 / 存储合并的外部行为（缺省、无效键回落、壳与活会话合并序、关 Tab 后集合、选中配置缺失回落），不测 PTY 与 Electron 生命周期。

要测：

- **激活键**：合法 stored 保留；指向缺失 run/terminal 时回落 ADR-0005（扩既有 `tab-activation` 用例即可）。
- **终端壳合并**（可提纯）：活终端 ∪ 盘壳 → 名字/顺序；活优先保留 key。
- **selectedKey 回落**：配置 id 不在树中 → null。
- **持久化形状**：老档案缺字段时的默认值（与 store 补齐路径一致）。

不写 UI/e2e（懒 spawn、热重载手测）。

先例：`tab-activation.test.ts`、`files-recent` / store 缺省补齐类测试。

## Out of Scope

- Run Session Tab / 输出 / 进程的跨重启恢复
- `idle` 占位 Run Session
- Terminal scrollback 持久化
- 多窗口各自工作台
- 终端数量上限
- 改变 ADR-0005 的默认激活优先级（记忆有效时仍优先记忆，与现逻辑一致）
- 将工作台状态写入各项目仓库目录

## Further Notes

- 术语见 CONTEXT.md（**Terminal** 已改为「元数据可持久、进程与输出不持久」）；决策见 ADR-0008 / 修订后的 ADR-0003、ADR-0002。
- DESIGN.md 中终端改名 / 排序「仅内存」的表述已改为跨重启保留，与本 PRD 对齐。
- 本仓库只维护 PRD，不另开 issue / 不跑 triage，除非另行要求。
