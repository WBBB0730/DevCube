// Git Tab 渲染端共享的视图模型类型：右键菜单目标、对话框请求、详情/diff 面板状态。
// 这是图谱表格（触发方）与菜单/对话框/详情组件（消费方）之间的接缝契约，字段勿随意增删。
import type {
  DiffFileData,
  GitCommitDetails,
  GitCommitStash,
  GitFileChange,
  GitMergeOn,
  GitOpInProgress,
  GitRebaseOn,
  GitUncommittedDetails
} from '@shared/git'

// —— 右键菜单 ——

/** 右键菜单的目标对象（决定菜单项集合；菜单项可见性数据见 menus 规格）。 */
export type GitMenuTarget =
  | { kind: 'commit'; hash: string }
  /** 本地分支标签 */
  | { kind: 'branch'; name: string; hash: string }
  /** 远程分支标签（或合并标签内的 remote 徽标）；remote 为 null 表示所属 remote 已不存在 */
  | { kind: 'remote-branch'; fullRef: string; remote: string | null; hash: string }
  | { kind: 'tag'; name: string; annotated: boolean; hash: string }
  | { kind: 'stash'; hash: string; stash: GitCommitStash }
  /** 未提交更改行 */
  | { kind: 'uncommitted' }
  /** 表头（列显隐 + 排序切换，checked 模式） */
  | { kind: 'header' }
  /** 提交详情面板的文件行 */
  | {
      kind: 'file'
      file: GitFileChange
      fromHash: string
      toHash: string
      /** 比较端点是否含未提交更改（影响「重置到此版本」等可见性） */
      isUncommitted: boolean
    }
  /** 提交面板（未提交行详情）文件行的 … 菜单 / 右键 */
  | { kind: 'uncommitted-file'; file: GitFileChange; section: 'staged' | 'unstaged' }
  /** 提交面板文件树多选批量操作（右键选区，files 为选区解析出的文件集合，同段） */
  | { kind: 'uncommitted-files'; files: GitFileChange[]; section: 'staged' | 'unstaged' }

export interface GitContextMenuState {
  /** 鼠标坐标（相对视口），菜单以虚拟 anchor 定位 */
  x: number
  y: number
  target: GitMenuTarget
}

// —— 对话框 ——

/**
 * 打开一个 git 对话框的请求（D1–D30，去掉 PR 创建）。表单默认值与字段规格见
 * menus-dialogs 规格书；追问链（重名替换 / 强制删除确认等）由对话框内部续弹。
 */
export type GitDialogRequest =
  /** 初始化 Git 仓库（非仓库兜底态入口）；defaultBranch 为打开时读到的预填分支名 */
  | { kind: 'init'; defaultBranch: string }
  | { kind: 'rename-branch'; branch: string }
  | { kind: 'delete-branch'; branch: string; remotesWithBranch: string[] }
  | { kind: 'merge'; obj: string; on: GitMergeOn; displayName: string }
  | { kind: 'rebase'; obj: string; on: GitRebaseOn; displayName: string }
  /** 推送分支（表单式 D5）；branch = 入口预设的本地分支（工具栏 = 当前分支，
      右键 / 提交并推送 = 该入口的分支），remote / 目标分支等其余字段在表单里选 */
  | { kind: 'push-branch'; branch: string }
  /** 检出远程分支（创建本地跟踪分支）；remote 为 null 表示孤儿远程 ref */
  | { kind: 'checkout-remote-branch'; remoteRef: string; remote: string | null }
  | { kind: 'delete-remote-branch'; remoteRef: string; remote: string; branch: string }
  | { kind: 'fetch-into-local'; remote: string; remoteBranch: string; localBranch: string }
  /** 拉取到当前分支（表单式 D10）；preset = 入口预设的 remote 与远程分支（右键远程分支标签），
      null = 表单按默认规则求值（工具栏入口） */
  | { kind: 'pull-branch'; preset: { remote: string; branch: string } | null }
  | { kind: 'add-tag'; hash: string }
  | { kind: 'delete-tag'; name: string }
  | { kind: 'push-tag'; name: string; hash: string }
  | { kind: 'create-branch'; hash: string }
  | { kind: 'checkout-commit'; hash: string }
  | { kind: 'cherrypick'; hash: string }
  | { kind: 'revert'; hash: string }
  | { kind: 'drop-commit'; hash: string }
  | { kind: 'reset'; hash: string }
  | { kind: 'stash-save' }
  | { kind: 'reset-uncommitted' }
  | { kind: 'clean-untracked' }
  | { kind: 'stash-apply'; selector: string }
  | { kind: 'stash-pop'; selector: string }
  | { kind: 'stash-drop'; selector: string }
  | { kind: 'stash-branch'; selector: string }
  /** annotated tag 详情（打开后异步加载 gitTagDetails） */
  | { kind: 'tag-details'; name: string }
  /** CDV 文件行「将文件重置到此版本」 */
  | { kind: 'reset-file'; hash: string; filePath: string }
  /** 提交面板文件行「撤销更改…」（未暂存段，工作区恢复为 index；单选传一项、多选传多项） */
  | { kind: 'discard-file'; paths: string[] }
  /** 提交面板文件行「删除文件…」（未跟踪文件，从磁盘删除；单选传一项、多选传多项） */
  | { kind: 'delete-untracked-file'; paths: string[] }
  /** 中止进行中的多步操作（状态条「中止」钮，危险确认；已解决的冲突进度将丢失） */
  | { kind: 'op-abort'; op: GitOpInProgress }

// —— 详情面板 / diff 面板 ——

/** 展开的提交详情（含比较模式）。compareWith 非 null = 比较模式。 */
export interface GitExpandedState {
  /** 展开的提交 hash（可为 UNCOMMITTED）；比较模式下是先选中的一端 */
  hash: string
  /** stash 伪提交行展开时携带 stash 信息 */
  stash: GitCommitStash | null
  /** 比较模式的另一端 hash（可为 UNCOMMITTED）；null = 普通详情 */
  compareWith: string | null
  details: GitCommitDetails | null
  /** 比较模式的文件变更列表（普通详情在 details.fileChanges） */
  fileChanges: GitFileChange[] | null
  /** 未提交行的两段明细（已暂存 / 未暂存，提交面板数据源）；其余目标为 null */
  uncommitted: GitUncommittedDetails | null
  loading: boolean
  error: string | null
}

/** 打开中的单文件 diff。from/to 已按「from=较老」归一化，to 可为 UNCOMMITTED。 */
export interface GitDiffViewState {
  file: GitFileChange
  fromHash: string
  toHash: string
  data: DiffFileData | null
  loading: boolean
  error: string | null
}

// —— 查找（find widget） ——

/** 提交查找状态：匹配集由查找组件计算后写回 store，表格据此渲染高亮。 */
export interface GitFindState {
  open: boolean
  query: string
  caseSensitive: boolean
  regex: boolean
  /** 命中提交的 hash（按表格行序） */
  matches: string[]
  /** 当前聚焦的匹配下标；-1 = 无 */
  activeIdx: number
}
