// Git 图谱的展示格式化纯函数：hash 缩写、相对时间、完整日期时间（日期/hash 列的 title 用）。
// 阈值与格式照抄参考实现（graph-table 规格 §4），相对时间文案中文化。

/** 月份缩写：沿用参考实现的「D MMM YYYY」英文短格式，保持列宽紧凑稳定。 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 补零到两位。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

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

/** Unix 秒 → 本地时区完整时间「D MMM YYYY HH:MM:SS」（悬浮 title 恒用完整精度）。 */
export function formatDateTime(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  return `${date} ${time}`
}
