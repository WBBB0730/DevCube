// Run —— main / preload / renderer 三端共享的域模型与 IPC 契约。
// 术语见 CONTEXT.md：Project / Discovered Script / Run Configuration（引用型·命令型）/ Run Session。

export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun'

/** 被登记进运行器的一个本地文件夹，以绝对路径为标识（ADR-0002）。 */
export interface Project {
  /** 绝对路径 —— 唯一标识 */
  path: string
  /** basename，用于展示 */
  name: string
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
}

/** 一个项目在聚合面板里的完整视图。 */
export interface ProjectNode {
  project: Project
  packageManager: PackageManager | null
  discovered: DiscoveredScript[]
  configs: RunConfig[]
}

export type SessionStatus = 'running' | 'exited' | 'failed'

/** 运行目标：一条探测脚本，或一条已保存配置。 */
export type RunTarget =
  { type: 'script'; projectPath: string; name: string } | { type: 'config'; id: string }

/** 渲染端看到的会话快照。key 为「可运行项唯一键」，同一 script/config 单实例。 */
export interface SessionState {
  key: string
  status: SessionStatus
  exitCode: number | null
}

export interface SessionOutput {
  key: string
  data: string
}

/** preload 经 contextBridge 暴露给渲染端的 API。随 slice 逐步实现。 */
export interface RunAPI {
  // —— 项目 / 树（slice 1） ——
  getTree(): Promise<ProjectNode[]>
  /** 打开系统文件夹选择器新增项目；返回更新后的树（用户取消则返回原树） */
  addProject(): Promise<ProjectNode[]>
  /** 拖入文件夹路径新增项目 */
  addProjectByPath(path: string): Promise<ProjectNode[]>
  removeProject(path: string): Promise<ProjectNode[]>

  // —— 运行时（slice 3+） ——
  run(target: RunTarget): Promise<void>
  stop(key: string): Promise<void>
  writeStdin(key: string, data: string): void
  resize(key: string, cols: number, rows: number): void
  /** 拉取某会话已缓冲的历史输出（切换选择时回填控制台） */
  getSessionBuffer(key: string): Promise<string>
  /** 当前所有活跃/已结束但保留的会话快照 */
  getSessions(): Promise<SessionState[]>

  // —— 命令型配置（slice 6） ——
  createCommandConfig(input: Omit<CommandRunConfig, 'id' | 'kind'>): Promise<ProjectNode[]>
  updateCommandConfig(config: CommandRunConfig): Promise<ProjectNode[]>
  deleteConfig(id: string): Promise<ProjectNode[]>
  /** 重排某项目下「我的配置」的顺序 */
  reorderConfigs(projectPath: string, orderedIds: string[]): Promise<ProjectNode[]>

  // —— 外链 ——
  /** 在系统默认浏览器打开 http/https 链接（终端可点击链接） */
  openExternal(url: string): Promise<void>

  // —— 事件订阅（返回取消函数） ——
  onTreeChanged(cb: (tree: ProjectNode[]) => void): () => void
  onSessionOutput(cb: (e: SessionOutput) => void): () => void
  onSessionStatus(cb: (e: SessionState) => void): () => void
  /** 会话被彻底销毁（配置删除/对账/项目移除），渲染端应清除其状态 */
  onSessionRemoved(cb: (key: string) => void): () => void
}
