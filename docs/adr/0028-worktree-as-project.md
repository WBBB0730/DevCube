# 工作树即 Project：不做原地切换，也不做子项目

要支持 git worktree（同仓库多份检出）时，Zed 的做法是「同一窗口换根目录」并把布局带过去。DevCube 的一切都挂在项目目录上——运行配置按目录探测、Run Session / Terminal 以目录为 cwd、Files Tab 与 Git Tab 也以目录为键——所以我们决定：**一个工作树目录就是一个 Project**，创建或前往工作树 = 登记（已登记则聚焦）该目录，复用 External Open 的「登记或聚焦」语义；Git Tab 只负责列出同仓库的工作树、标注被占用的分支、提供跳转入口。

## Considered Options

- **工作树即 Project（选中）**：零新实体、零 Tab 模型改动；代价是同仓库的多个 Project 各自持有监听与 git 设置，链接工作树的 Project 须额外盯主仓库的公共 gitdir。
- **同一 Project 内原地切换工作树**：Project 以路径为唯一键，切换会让运行中会话的 cwd、每项目 Tab 记忆与 Files 现场一起失效。
- **左树里挂成主项目的子项目**：要改树模型、拖拽排序与 Pin 边界，收益只是视觉上的归属感。

## Consequences

- 链接工作树登记为 Project 后，监听除项目目录外还订阅主仓库的公共 gitdir（共享 refs、各工作树的 HEAD、`worktrees/` 目录增删），否则外部切分支、提交不会触发刷新。
- 删除工作树时须一并移除其 Project；其下有运行中的会话或终端则拒绝删除，让用户先停。
