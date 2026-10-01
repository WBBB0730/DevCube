// 以文字为键的小 LRU 缓存（照 mycli 对解析结果用的 functools.lru_cache(maxsize=128)）：Map 保持插入次序，读到的项
// 移到末尾，超出容量时丢掉最久没用的。容量按项数与键的总字数两样算：长语句每次按键都会产生新的整段文字，只按项数
// 的话缓存里会积下上百棵长语句的树。

export class LruCache<V> {
  private readonly map = new Map<string, V>()
  private chars = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxChars: number
  ) {}

  /** 取缓存的值；没有时算出并存下。 */
  getOrCompute(key: string, compute: () => V): V {
    if (this.map.has(key)) {
      const value = this.map.get(key)!
      this.map.delete(key)
      this.map.set(key, value)
      return value
    }
    const value = compute()
    this.map.set(key, value)
    this.chars += key.length
    for (const oldest of this.map.keys()) {
      if (this.map.size <= this.maxEntries && this.chars <= this.maxChars) break
      this.map.delete(oldest)
      this.chars -= oldest.length
    }
    return value
  }
}
