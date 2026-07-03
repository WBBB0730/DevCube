// Git 图谱的展示格式化纯函数：hash 缩写、相对时间、完整日期时间（tooltip 与详情面板用）。
// 相对时间阈值照抄参考实现（graph-table 规格 §4），文案中文化；完整日期时间改用 Intl 标准 API 输出中文格式。

/** 完整日期时间格式器：模块级复用，避免每次调用都 new。 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

/** 提交 hash 缩写：固定前 8 位，不做唯一性动态加长。 */
export function abbrevHash(hash: string): string {
  return hash.substring(0, 8)
}

// —— 纯核心（供测试）：相对时间按「秒差」计算，与当前时钟解耦 ——

/**
 * 秒差 → 中文相对时间文案。阈值与参考实现一致（60/3600/86400/604800/2629800/31557600，
 * 平均月 = 365.25/12 天），商四舍五入；负差值（机器时钟偏差）钳制为 0。
 */
export function formatRelativeDuration(diffSec: number): string {
  const diff = Math.max(diffSec, 0)
  if (diff < 60) return `${Math.round(diff)} 秒前`
  if (diff < 3600) return `${Math.round(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.round(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.round(diff / 86400)} 天前`
  if (diff < 2629800) return `${Math.round(diff / 604800)} 周前`
  if (diff < 31557600) return `${Math.round(diff / 2629800)} 个月前`
  return `${Math.round(diff / 31557600)} 年前`
}

/** Unix 秒 → 相对当前时刻的中文相对时间（「N 秒/分钟/小时/天/周/个月/年前」）。 */
export function formatRelativeTime(unixSec: number): string {
  return formatRelativeDuration(Date.now() / 1000 - unixSec)
}

/** Unix 秒 → 本地时区完整时间「2026年7月3日 09:05:07」（24 小时制、时分秒补零，悬浮 title 恒用完整精度）。 */
export function formatDateTime(unixSec: number): string {
  return DATE_TIME_FORMAT.format(new Date(unixSec * 1000))
}
