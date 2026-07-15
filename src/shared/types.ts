// Run —— main / preload / renderer 三端共享的域模型与 IPC 契约。
// 术语见 CONTEXT.md：Project / Discovered Script / Run Configuration（引用型·命令型）/ Run Session。
// Git 图谱（Git Tab）的域模型与 API 在 ./git.ts，经 GitAPI 并入 RunAPI。

import type { GitAPI, GitRepoSettings, GitViewPrefs } from './git'

export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun'

/** 被登记进运行器的一个本地文件夹，以绝对路径为标识（ADR-0002）。 */
export interface Project {
  /** 绝对路径 —— 唯一标识 */
  path: string
  /** basename，用于展示 */
  name: string
  /** 登记进 DevCube 的时间（epoch ms）；老档案缺省时读取层补当前时间 */
  addedAt: number
  /** 最近打开该项目的时间（epoch ms）；登记时写入，之后每次选中刷新；老档案缺省为 null */
  lastOpenedAt: number | null
  /** 是否 Pin（置顶）；老档案缺省为 false */
  pinned: boolean
}

/** 左树项目列表的排序方式。 */
export type ProjectSortMode = 'custom' | 'name' | 'addedAt' | 'lastOpenedAt'

/** 排序方向：名称 A→Z / 时间旧→新 为 asc；反之 desc。自定义与打开时间忽略方向（打开时间恒为最近→最远）。 */
export type ProjectSortDirection = 'asc' | 'desc'

/** 跨重启保留的项目列表排序偏好。 */
export interface ProjectSortPrefs {
  mode: ProjectSortMode
  direction: ProjectSortDirection
  /** 已 Pin 项目行是否叠放吸顶；关则置顶/未置顶均按当前段吸顶（视口最上一项）。默认开。 */
  pinSticky: boolean
}

/** 默认：添加时间倒序（新→旧）。已持久化的偏好不被覆盖。 */
export const DEFAULT_PROJECT_SORT_PREFS: ProjectSortPrefs = {
  mode: 'addedAt',
  direction: 'desc',
  pinSticky: true
}

/** 从 package.json 的 scripts 实时派生的只读候补，不持久化。 */
export interface DiscoveredScript {
  projectPath: string
  /** script 名 */
  name: string
  /** package.json 里该 script 的原始命令，用于展示 */
  command: string
}

/** 引用型：晋升自 Discovered Script，纯引用 (projectPath, scriptName)，不可自定义。 */
export interface ReferencedRunConfig {
  id: string
  kind: 'referenced'
  projectPath: string
  scriptName: string
}

/** 命令型：用户拥有的独立命令，完全可自定义，不引用任何 script。 */
export interface CommandRunConfig {
  id: string
  kind: 'command'
  projectPath: string
  name: string
  command: string
  /** 相对项目根解析；缺省即项目根 */
  cwd?: string
  /** 叠加在继承环境之上 */
  env?: Record<string, string>
}

export type RunConfig = ReferencedRunConfig | CommandRunConfig

/** 落盘的持久化状态（存于 electron-store 的 JSON）。 */
export interface PersistedState {
  projects: Project[]
  configs: RunConfig[]
  /** 每项目 git 设置（键 = 项目绝对路径；存的是覆写快照，读取时与默认值合并） */
  gitSettings: Record<string, GitRepoSettings>
  /** 跨项目 git 视图偏好（查找选项、「不再提示」标记） */
  gitViewPrefs: GitViewPrefs
  /** 左树项目列表排序偏好 */
  projectSortPrefs: ProjectSortPrefs
}

/** 一个项目在聚合面板里的完整视图。 */
export interface ProjectNode {
  project: Project
  packageManager: PackageManager | null
  discovered: DiscoveredScript[]
  configs: RunConfig[]
}

/** 添加 / 新建 / 拖入项目的结果：树 + 应聚焦的路径（取消或无效则为 null）。 */
export interface ProjectAddResult {
  tree: ProjectNode[]
  focusPath: string | null
}

export type SessionStatus = 'running' | 'exited' | 'failed'

/** 运行目标：一条探测脚本，或一条已保存配置。 */
export type RunTarget =
  { type: 'script'; projectPath: string; name: string } | { type: 'config'; id: string }

/** 渲染端看到的会话快照。key 为配置唯一键，同一 script/config 单实例。 */
export interface SessionState {
  key: string
  status: SessionStatus
  exitCode: number | null
}

export interface SessionOutput {
  key: string
  /** 会话代际标识：同 key 重跑即换新会话、bytes 从零重计，跨代事件必须按 sid 丢弃 */
  sid: string
  data: string
  /** 该块写入后本会话输出流的累计字节长度；用于去重，消除「快照 vs 实时事件」的竞态窗口 */
  bytes: number
}

/** 某会话的屏幕快照：主进程无头终端 serialize 出的当前画面（含滚动历史，ADR-0004）。 */
export interface SessionBufferSnapshot {
  /** 快照来源会话的代际标识；渲染端只对同 sid 的实时事件做 bytes 去重 */
  sid: string
  /** 序列化的屏幕内容（按 cols 宽度编码的 ANSI 流），非原始输出流 */
  data: string
  /**
   * 快照对应的累计输出流长度，供实时事件去重——回填期间与完成后皆需：
   * 快照回复与输出事件走不同派发通道，到达顺序没有保证。
   */
  bytes: number
  /** pty 当前列/行数。回填必须先把 xterm 调到此尺寸再写入 */
  cols: number
  rows: number
}

/** 一个活跃 Terminal（自由 shell）的最小信息，供渲染端重建其 Tab（术语见 CONTEXT.md）。 */
export interface TerminalInfo {
  /** 会话唯一键（`terminal:<uuid>`），与 Run Session 共用同一套输出/输入/缓冲通道 */
  key: string
  /** 所属项目绝对路径 —— 决定 cwd 与它归属的 Tab 栏 */
  projectPath: string
}

/** preload 经 contextBridge 暴露给渲染端的 API。随 slice 逐步实现；Git 部分见 GitAPI。 */
export interface RunAPI extends GitAPI {
  // —— 项目 / 树（slice 1） ——
  getTree(): Promise<ProjectNode[]>
  /** 打开系统文件夹选择器新增项目；取消则 focusPath 为 null */
  addProject(): Promise<ProjectAddResult>
  /** 拖入 / 按路径登记项目；已存在亦返回该路径以便聚焦 */
  addProjectByPath(path: string): Promise<ProjectAddResult>
  /** 打开系统保存面板新建项目文件夹并登记；取消则 focusPath 为 null */
  createProject(): Promise<ProjectAddResult>
  removeProject(path: string): Promise<ProjectNode[]>
  /** 重排项目列表顺序（自定义排序的落盘顺序） */
  reorderProjects(orderedPaths: string[]): Promise<ProjectNode[]>
  /** 记录「打开」某项目（更新 lastOpenedAt） */
  touchProject(path: string): Promise<ProjectNode[]>
  /** 设置 Project 的 Pin；置顶/取消后进入目标区块开头 */
  setProjectPinned(path: string, pinned: boolean): Promise<ProjectNode[]>
  getProjectSortPrefs(): Promise<ProjectSortPrefs>
  setProjectSortPrefs(patch: Partial<ProjectSortPrefs>): Promise<ProjectSortPrefs>

  // —— 运行时（slice 3+） ——
  run(target: RunTarget): Promise<void>
  stop(key: string): Promise<void>
  writeStdin(key: string, data: string): void
  resize(key: string, cols: number, rows: number): void
  /** 拉取某会话的屏幕快照（切换选择/刷新时回填控制台；含累计流长度用于去重） */
  getSessionBuffer(key: string): Promise<SessionBufferSnapshot>
  /** 清空某会话的控制台输出（进程继续跑；换代 sid，bytes 归零） */
  clearSessionOutput(key: string): Promise<void>
  /** 当前所有活跃/已结束但保留的会话快照 */
  getSessions(): Promise<SessionState[]>

  // —— 终端（Terminal，自由 shell） ——
  /** 在项目根目录起一个交互 shell 的新 Terminal，返回其会话键 */
  openTerminal(projectPath: string): Promise<string>
  /**
   * 关闭一个 Tab 对应的会话（Run Session 或 Terminal）：
   * 运行中则先 SIGTERM 温和停止（超时升级 SIGKILL），随即弃掉会话与输出。
   */
  closeSession(key: string): Promise<void>
  /** 当前所有活跃 Terminal（供渲染端重建 Tab，如 dev 热重载后） */
  getTerminals(): Promise<TerminalInfo[]>

  // —— 命令型配置（slice 6） ——
  createCommandConfig(input: Omit<CommandRunConfig, 'id' | 'kind'>): Promise<ProjectNode[]>
  updateCommandConfig(config: CommandRunConfig): Promise<ProjectNode[]>
  deleteConfig(id: string): Promise<ProjectNode[]>
  /** 重排某项目下「我的配置」的顺序 */
  reorderConfigs(projectPath: string, orderedIds: string[]): Promise<ProjectNode[]>
  /** 把一条探测脚本晋升为引用型配置（选中即入列，不必等运行）；返回更新后的树 */
  promoteScript(projectPath: string, scriptName: string): Promise<ProjectNode[]>

  // —— 外链 ——
  /** 在系统默认浏览器打开 http/https 链接（终端可点击链接） */
  openExternal(url: string): Promise<void>
  /** 用系统默认应用打开本地文件（Git 详情面板「打开文件」） */
  openPath(path: string): Promise<void>
  /** 在系统文件管理器中定位并选中该文件（「在文件夹中显示」） */
  revealInFolder(path: string): Promise<void>

  // —— 事件订阅（返回取消函数） ——
  onTreeChanged(cb: (tree: ProjectNode[]) => void): () => void
  onSessionOutput(cb: (e: SessionOutput) => void): () => void
  onSessionStatus(cb: (e: SessionState) => void): () => void
  /** 会话被彻底销毁（配置删除/对账/项目移除），渲染端应清除其状态 */
  onSessionRemoved(cb: (key: string) => void): () => void
}
