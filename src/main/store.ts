import type ElectronStore from 'electron-store'
import type {
  PersistedState,
  Project,
  ProjectSortPrefs,
  RunConfig
} from '../shared/types'
import { DEFAULT_PROJECT_SORT_PREFS } from '../shared/types'
import {
  DEFAULT_GIT_REPO_SETTINGS,
  DEFAULT_GIT_VIEW_PREFS,
  type GitRepoSettings,
  type GitViewPrefs
} from '../shared/git'

// electron-store 是纯 ESM，从 CJS 主进程用动态 import 加载；落盘为 userData/devcube.json（ADR-0002）。
let store: ElectronStore<PersistedState>

export async function initStore(): Promise<void> {
  const { default: Store } = await import('electron-store')
  store = new Store<PersistedState>({
    name: 'devcube',
    defaults: {
      projects: [],
      configs: [],
      gitSettings: {},
      gitViewPrefs: DEFAULT_GIT_VIEW_PREFS,
      projectSortPrefs: DEFAULT_PROJECT_SORT_PREFS
    }
  })
}

/** 老档案缺 addedAt / lastOpenedAt / pinned 时补齐；首次读到脏数据即回写，避免每次 Date.now() 抖动。 */
export function getProjects(): Project[] {
  const raw = store.get('projects')
  const now = Date.now()
  let dirty = false
  const projects = raw.map((p) => {
    const addedAt = typeof p.addedAt === 'number' ? p.addedAt : now
    const lastOpenedAt = typeof p.lastOpenedAt === 'number' ? p.lastOpenedAt : null
    const pinned = p.pinned === true
    if (addedAt !== p.addedAt || lastOpenedAt !== (p.lastOpenedAt ?? null) || p.pinned !== pinned) {
      dirty = true
    }
    return { path: p.path, name: p.name, addedAt, lastOpenedAt, pinned }
  })
  if (dirty) store.set('projects', projects)
  return projects
}

export function setProjects(projects: Project[]): void {
  store.set('projects', projects)
}

export function getConfigs(): RunConfig[] {
  return store.get('configs')
}

export function setConfigs(configs: RunConfig[]): void {
  store.set('configs', configs)
}

// —— Git 设置（每项目）与视图偏好 ——
// 读取时与默认值合并：老档案缺新字段也能得到完整形状，写入只存合并后的快照。
// 合并前先按当前类型的已知键挑拣一次：产品演进删过字段（name / issueLinkingConfig /
// globalIssueLinkingConfig 等），老 JSON 里残留的未知键若直接展开会混进快照并被再次写盘。

/** 从持久化对象里只挑拣 defaults 声明的已知键（丢弃老档案残留的未知键）。 */
function pickKnownKeys<T extends object>(defaults: T, stored: Partial<T> | undefined): Partial<T> {
  const out: Partial<T> = {}
  if (stored === undefined) return out
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (key in stored) out[key] = stored[key]
  }
  return out
}

export function getGitSettings(projectPath: string): GitRepoSettings {
  return {
    ...DEFAULT_GIT_REPO_SETTINGS,
    ...pickKnownKeys(DEFAULT_GIT_REPO_SETTINGS, store.get('gitSettings')[projectPath])
  }
}

export function setGitSettings(
  projectPath: string,
  patch: Partial<GitRepoSettings>
): GitRepoSettings {
  const merged = { ...getGitSettings(projectPath), ...patch }
  store.set('gitSettings', { ...store.get('gitSettings'), [projectPath]: merged })
  return merged
}

/** 项目移除时清掉它的 git 设置，避免残留。 */
export function deleteGitSettings(projectPath: string): void {
  const all = { ...store.get('gitSettings') }
  delete all[projectPath]
  store.set('gitSettings', all)
}

export function getGitViewPrefs(): GitViewPrefs {
  return {
    ...DEFAULT_GIT_VIEW_PREFS,
    ...pickKnownKeys(DEFAULT_GIT_VIEW_PREFS, store.get('gitViewPrefs'))
  }
}

export function setGitViewPrefs(patch: Partial<GitViewPrefs>): GitViewPrefs {
  const merged = { ...getGitViewPrefs(), ...patch }
  store.set('gitViewPrefs', merged)
  return merged
}

export function getProjectSortPrefs(): ProjectSortPrefs {
  return {
    ...DEFAULT_PROJECT_SORT_PREFS,
    ...pickKnownKeys(DEFAULT_PROJECT_SORT_PREFS, store.get('projectSortPrefs'))
  }
}

export function setProjectSortPrefs(patch: Partial<ProjectSortPrefs>): ProjectSortPrefs {
  const merged = { ...getProjectSortPrefs(), ...patch }
  store.set('projectSortPrefs', merged)
  return merged
}
