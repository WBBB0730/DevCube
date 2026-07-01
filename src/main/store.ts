import type ElectronStore from 'electron-store'
import type { PersistedState, Project, RunConfig } from '../shared/types'

// electron-store 是纯 ESM，从 CJS 主进程用动态 import 加载；落盘为 userData/run.json（ADR-0002）。
let store: ElectronStore<PersistedState>

export async function initStore(): Promise<void> {
  const { default: Store } = await import('electron-store')
  store = new Store<PersistedState>({
    name: 'run',
    defaults: { projects: [], configs: [] }
  })
}

export function getProjects(): Project[] {
  return store.get('projects')
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
