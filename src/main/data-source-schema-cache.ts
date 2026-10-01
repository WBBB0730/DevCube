// 表结构缓存（docs/prd/database.md「目录」）：登记的数据源各一个 JSON 文件，放在 userData 下自己的目录里。只存结构——
// 目录各层、对象定义、补全用的表结构（列与类型、函数、外键等）——不存表数据；Redis 的键属于数据，不缓存。只存读成功的
// 结果。
// 界面先显示缓存、同时现查，现查到了原地替换并写回（见 data-source-sessions），所以缓存不会一直过时。
// 第一次用到时读进内存；写盘防抖，先写临时文件再改名，写到一半退出也不会留下坏文件。连接信息被改、数据源被移除时删掉；
// 退出时把待写的写完。

import { app } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CatalogNode } from '../shared/data-source-catalog'
import type { CompletionSchema, ObjectDetail, QueryFailure } from '../shared/data-source-query'

const CACHE_DIR_NAME = 'data-source-schemas'
/** 文件格式的版本：格式变了就加一，旧文件当作没有缓存 */
const CACHE_VERSION = 5
/** 写盘防抖：连上后一次读完的各层接连写进来，攒一会儿写一次 */
const SAVE_DELAY_MS = 1000

/** 各部分存的东西。 */
interface SchemaCacheValues {
  /** 目录一层的子节点（按 catalogLayerKey） */
  catalog: CatalogNode[]
  /** 对象的定义或信息表（按对象的目录节点键） */
  objects: Exclude<ObjectDetail, QueryFailure>
  /** 补全用的表结构（按库） */
  completion: CompletionSchema
}

export type SchemaCacheSection = keyof SchemaCacheValues
export type SchemaCacheValue<S extends SchemaCacheSection> = SchemaCacheValues[S]

/**
 * 内存里的一份缓存：各部分按键存。登记的数据源的读进内存后即这样；Files 面板里直接打开的 SQLite 文件只有会话内存里的
 * 这一份（见 data-source-sessions），不经这里读写盘。
 */
export type SchemaCache = { [S in SchemaCacheSection]: Map<string, SchemaCacheValues[S]> }

/** 文件里的样子。 */
type SchemaCacheFile = { version: number } & {
  [S in SchemaCacheSection]: Record<string, SchemaCacheValues[S]>
}

interface Entry {
  /** 读进内存的一份（第一次用到时从磁盘读） */
  cache: Promise<SchemaCache>
  /** 防抖中的写盘 */
  timer: ReturnType<typeof setTimeout> | null
  /** 写盘排队：同一个文件一次只写一份 */
  saving: Promise<void>
}

const entries = new Map<string, Entry>()
/** 正在删的缓存文件：删完之前不读它，免得读回旧内容 */
const removing = new Map<string, Promise<void>>()

function fileOf(dataSourceId: string): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME, `${dataSourceId}.json`)
}

export function emptySchemaCache(): SchemaCache {
  return { catalog: new Map(), objects: new Map(), completion: new Map() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCacheFile(data: unknown): data is SchemaCacheFile {
  return (
    isRecord(data) &&
    data.version === CACHE_VERSION &&
    isRecord(data.catalog) &&
    isRecord(data.objects) &&
    isRecord(data.completion)
  )
}

async function load(dataSourceId: string): Promise<SchemaCache> {
  try {
    const data: unknown = JSON.parse(await readFile(fileOf(dataSourceId), 'utf8'))
    if (isCacheFile(data)) {
      return {
        catalog: new Map(Object.entries(data.catalog)),
        objects: new Map(Object.entries(data.objects)),
        completion: new Map(Object.entries(data.completion))
      }
    }
  } catch {
    // 没有文件、读不了或内容坏了：当作没有缓存
  }
  return emptySchemaCache()
}

async function save(dataSourceId: string, cache: SchemaCache): Promise<void> {
  const file = fileOf(dataSourceId)
  const tmp = `${file}.${process.pid}.tmp`
  const data: SchemaCacheFile = {
    version: CACHE_VERSION,
    catalog: Object.fromEntries(cache.catalog),
    objects: Object.fromEntries(cache.objects),
    completion: Object.fromEntries(cache.completion)
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify(data))
    await rename(tmp, file)
  } catch {
    // 写不了（如磁盘满）不管：缓存只是让界面先有东西看，下次现查到了再写
    await rm(tmp, { force: true }).catch(() => {})
  }
}

function entryOf(dataSourceId: string): Entry {
  let entry = entries.get(dataSourceId)
  if (entry === undefined) {
    const removed = removing.get(dataSourceId) ?? Promise.resolve()
    entry = {
      cache: removed.then(() => load(dataSourceId)),
      timer: null,
      saving: Promise.resolve()
    }
    entries.set(dataSourceId, entry)
  }
  return entry
}

function queueSave(dataSourceId: string, entry: Entry): void {
  entry.saving = entry.saving.then(async () => save(dataSourceId, await entry.cache))
}

/** 取缓存里的一项；没有为 null。 */
export async function readSchemaCache<S extends SchemaCacheSection>(
  dataSourceId: string,
  section: S,
  key: string
): Promise<SchemaCacheValue<S> | null> {
  const cache = await entryOf(dataSourceId).cache
  return cache[section].get(key) ?? null
}

/** 取缓存里一部分的全部项（按键）；没有为空。 */
export async function readSchemaCacheSection<S extends SchemaCacheSection>(
  dataSourceId: string,
  section: S
): Promise<ReadonlyMap<string, SchemaCacheValue<S>>> {
  const cache = await entryOf(dataSourceId).cache
  return cache[section]
}

/** 存进缓存（覆盖同键的旧值），防抖写盘；读盘的这会儿缓存被删了不存。 */
export function writeSchemaCache<S extends SchemaCacheSection>(
  dataSourceId: string,
  section: S,
  key: string,
  value: SchemaCacheValue<S>
): void {
  const entry = entryOf(dataSourceId)
  void entry.cache.then((cache) => {
    if (entries.get(dataSourceId) !== entry) return
    cache[section].set(key, value)
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      queueSave(dataSourceId, entry)
    }, SAVE_DELAY_MS)
  })
}

/** 删掉一个数据源的缓存（连接信息被改、数据源被移除时）：等写到一半的写完再删文件。 */
export function deleteSchemaCache(dataSourceId: string): Promise<void> {
  const entry = entries.get(dataSourceId)
  entries.delete(dataSourceId)
  if (entry?.timer != null) clearTimeout(entry.timer)
  const done = (entry?.saving ?? Promise.resolve())
    .then(() => rm(fileOf(dataSourceId), { force: true }))
    // 删不掉不管：下次读到旧结构也会随即被现查的结果替换
    .catch(() => {})
  removing.set(dataSourceId, done)
  void done.then(() => {
    if (removing.get(dataSourceId) === done) removing.delete(dataSourceId)
  })
  return done
}

/** 退出时把待写的写完（不等防抖）。 */
export async function flushSchemaCaches(): Promise<void> {
  // 先等读盘中的缓存读完：排在读盘后面的写入这时已记进内存、排好了写盘
  await Promise.all([...entries.values()].map((entry) => entry.cache))
  for (const [dataSourceId, entry] of entries) {
    if (entry.timer === null) continue
    clearTimeout(entry.timer)
    entry.timer = null
    queueSave(dataSourceId, entry)
  }
  await Promise.all([...[...entries.values()].map((entry) => entry.saving), ...removing.values()])
}
