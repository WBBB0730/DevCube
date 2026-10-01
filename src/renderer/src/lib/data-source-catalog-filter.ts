/**
 * 目录树顶的「按名称筛选」（docs/prd/database.md「目录」）：在 DevCube 已经拿到的各层里找——已读取的，加上表结构缓存里
 * 有的（同一层以已读取的为准）；不为筛选另查数据库。库、模式与对象的名称含查询（不分大小写）即命中；命中的节点连同它的
 * 各级祖先一起显示（保留层级结构，同 Files 筛选），命中的库 / 模式下拿到的各层整支纳入。分组没有名称，只跟着命中的对象
 * 或整支纳入时显示。筛选视图默认全部展开，开合只记用户的显式操作（见 FilterOverrides）。
 */
import {
  catalogNodeKey,
  childPath,
  type CatalogNode,
  type CatalogPath,
  type CatalogResult
} from '@shared/data-source-catalog'

export interface FilteredCatalog {
  /** 筛过的根这一层；没有命中即为空 */
  root: { nodes: CatalogNode[] }
  /** 筛过的各层（键同 flattenCatalog 的 loaded）：只含要显示的层 */
  loaded: Map<string, CatalogResult>
  /** 筛过的各层的位置（同 childPath，键同 loaded） */
  paths: Map<string, CatalogPath>
}

export function filterCatalog(
  root: CatalogResult,
  loaded: ReadonlyMap<string, CatalogResult>,
  cached: ReadonlyMap<string, CatalogResult>,
  query: string
): FilteredCatalog {
  const q = query.trim().toLowerCase()
  const kept = new Map<string, CatalogResult>()
  const paths = new Map<string, CatalogPath>()

  /** 拿到的一层：已读取的为准，没读取过的取缓存 */
  const layerOf = (key: string): CatalogResult | undefined => loaded.get(key) ?? cached.get(key)
  const keep = (key: string, path: CatalogPath, result: CatalogResult): void => {
    kept.set(key, result)
    paths.set(key, path)
  }

  /** 命中节点之下拿到的各层原样纳入 */
  const keepAll = (key: string, path: CatalogPath): void => {
    const result = layerOf(key)
    if (result === undefined) return
    keep(key, path, result)
    if (!('nodes' in result)) return
    for (const node of result.nodes) {
      if (node.kind !== 'object') keepAll(catalogNodeKey(path, node), childPath(path, node))
    }
  }

  /** 一层里要显示的节点：自己命中，或它下面（拿到的部分）有命中 */
  const walk = (result: CatalogResult | undefined, path: CatalogPath): CatalogNode[] => {
    if (result === undefined || !('nodes' in result)) return []
    const nodes: CatalogNode[] = []
    for (const node of result.nodes) {
      const key = catalogNodeKey(path, node)
      if (node.kind !== 'group' && node.name.toLowerCase().includes(q)) {
        nodes.push(node)
        if (node.kind !== 'object') keepAll(key, childPath(path, node))
      } else if (node.kind !== 'object') {
        const at = childPath(path, node)
        const children = walk(layerOf(key), at)
        if (children.length > 0) {
          keep(key, at, { nodes: children })
          nodes.push(node)
        }
      }
    }
    return nodes
  }

  return { root: { nodes: walk(root, {}) }, loaded: kept, paths }
}

/**
 * 筛选视图的开合：只记用户的显式操作（层键到开 / 合）。没开合过的层按默认：筛过的层（filterCatalog 的 loaded）都展开，
 * 之后新出现的（缓存重取后多筛出的）也展开。
 */
export type FilterOverrides = ReadonlyMap<string, boolean>

/** 筛选视图里展开着的层：开合过的以开合为准，其余按默认。 */
export function filterViewExpanded(
  filtered: FilteredCatalog,
  overrides: FilterOverrides
): { has(key: string): boolean } {
  return { has: (key) => overrides.get(key) ?? filtered.loaded.has(key) }
}

/** 筛选视图的全部折叠：当前各层（筛过的与开合过的）都记为合上。 */
export function collapseFilterView(
  filtered: FilteredCatalog,
  overrides: FilterOverrides
): Map<string, boolean> {
  return new Map([...filtered.loaded.keys(), ...overrides.keys()].map((key) => [key, false]))
}
