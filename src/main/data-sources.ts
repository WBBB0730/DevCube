// 数据源（Data Source）登记与记住的密码；术语见 CONTEXT.md，取舍见 ADR-0043。

import { randomUUID } from 'node:crypto'
import {
  defaultDataSourceName,
  type DataSource,
  type DataSourceInput,
  type DataSourceNode
} from '../shared/data-source'
import type { PasswordChange } from '../shared/connection'
import { catalogListedDatabases, type CatalogNode } from '../shared/data-source-catalog'
import type { CompletionUsage } from '../shared/data-source-query'
import { dropRecentOpened, pushRecentOpened, type DataSourceOpened } from '../shared/data-source-ui'
import type { DataSourceRunConfig } from '../shared/types'
import { applyPasswordChange, decryptSecret } from './secrets'
import {
  deleteDataSourceCompletionUsage,
  deleteDataSourceRecents,
  forgetDataSourceTabPlaces,
  getConfigs,
  getDataSourceRecents,
  getDataSourceSecret,
  getDataSources,
  setDataSourceCompletionUsage,
  setDataSourceRecents,
  setDataSourceSecret,
  setDataSources
} from './store'
import { headOrder } from './tree-order'

export function listDataSourceNodes(): DataSourceNode[] {
  const configs = getConfigs()
  return getDataSources().map((dataSource) => ({
    dataSource,
    hasPassword: getDataSourceSecret(dataSource.id) !== null,
    configs: configs.filter(
      (c): c is DataSourceRunConfig => c.kind === 'dataSource' && c.dataSourceId === dataSource.id
    )
  }))
}

export function findDataSource(id: string): DataSource | null {
  return getDataSources().find((d) => d.id === id) ?? null
}

export function readDataSourcePassword(id: string): string | null {
  return decryptSecret(getDataSourceSecret(id))
}

/** 按表单的处理改记住的密码（见 applyPasswordChange）。 */
export function applyDataSourcePassword(id: string, password: PasswordChange): void {
  applyPasswordChange(password, (secret) => setDataSourceSecret(id, secret))
}

function nameOf(input: DataSourceInput): string {
  return input.name.trim() || defaultDataSourceName(input.target)
}

/**
 * 登记数据源，返回它的 id；插到自定义序最前。连接目标与已登记的相同也照样登记（允许重复，对话框里提交前已确认过）。
 */
export function addDataSource(input: DataSourceInput): string {
  const dataSources = getDataSources()
  const now = Date.now()
  const dataSource: DataSource = {
    id: randomUUID(),
    name: nameOf(input),
    target: input.target,
    addedAt: now,
    lastOpenedAt: now,
    pinned: false,
    order: headOrder()
  }
  setDataSources([dataSource, ...dataSources])
  applyDataSourcePassword(dataSource.id, input.password)
  return dataSource.id
}

/** 按表单改登记。 */
export function updateDataSource(id: string, input: DataSourceInput): void {
  setDataSources(
    getDataSources().map((d) =>
      d.id === id ? { ...d, name: nameOf(input), target: input.target } : d
    )
  )
  applyDataSourcePassword(id, input.password)
}

/** 记下显示的库（目录根行的勾选，这个数据源的各个 Tab 一样）。 */
export function setDataSourceShownDatabases(id: string, databases: string[]): void {
  setDataSources(
    getDataSources().map((d) => (d.id === id ? { ...d, shownDatabases: databases } : d))
  )
}

/**
 * 读到了根这一层 root：显示的库里根这一层不再列出的（已删掉）去掉，交回去掉了没有。从没设置过的不改（默认库不在名单里）。
 */
export function pruneDataSourceShownDatabases(id: string, root: readonly CatalogNode[]): boolean {
  const saved = findDataSource(id)?.shownDatabases
  if (saved === undefined) return false
  const listed = catalogListedDatabases(saved, root)
  if (listed.length === saved.length) return false
  setDataSourceShownDatabases(id, listed)
  return true
}

/** 删掉登记，连同记住的密码、最近打开与补全的使用次数。 */
export function removeDataSource(id: string): void {
  setDataSources(getDataSources().filter((d) => d.id !== id))
  applyDataSourcePassword(id, null)
  deleteDataSourceRecents(id)
  deleteDataSourceCompletionUsage(id)
}

/**
 * 数据源的连接信息被改（连到的可能已是别的库）：显示的库回到默认，忘掉它的最近打开，与它的各个 Tab（tabKeys）记住的
 * 对象、目录展开和控制台上下文（见 forgetDataSourceTabPlaces）。
 */
export function forgetDataSourcePlaces(id: string, tabKeys: string[]): void {
  setDataSources(
    getDataSources().map((d) => {
      if (d.id !== id) return d
      const next = { ...d }
      delete next.shownDatabases
      return next
    })
  )
  deleteDataSourceRecents(id)
  forgetDataSourceTabPlaces(tabKeys)
}

export function touchDataSource(id: string): void {
  const now = Date.now()
  setDataSources(getDataSources().map((d) => (d.id === id ? { ...d, lastOpenedAt: now } : d)))
}

/**
 * 数据源的某个 Tab 打开了一个对象或键：放到它最近打开的最前（它的各个 Tab 共用），交回新的列表。数据源已移除时不记。
 */
export function pushDataSourceRecent(id: string, opened: DataSourceOpened): DataSourceOpened[] {
  if (findDataSource(id) === null) return []
  const next = pushRecentOpened(getDataSourceRecents(id), opened)
  setDataSourceRecents(id, next)
  return next
}

/**
 * 记下补全的使用次数（由渲染端计数：切词在补全引擎里）。数据源已移除时不记，免得留下没人用的记录。
 */
export function saveDataSourceCompletionUsage(id: string, usage: CompletionUsage): void {
  if (findDataSource(id) !== null) setDataSourceCompletionUsage(id, usage)
}

/** 已不在的对象或键从最近打开里去掉，交回新的列表。 */
export function dropDataSourceRecent(id: string, opened: DataSourceOpened): DataSourceOpened[] {
  const recents = getDataSourceRecents(id)
  const next = dropRecentOpened(recents, opened)
  if (next.length !== recents.length) setDataSourceRecents(id, next)
  return next
}
