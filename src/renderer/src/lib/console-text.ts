// 控制台里写的内容（docs/prd/database.md「控制台」）：跨重启保留，连续输入只在停下片刻后写盘一次，
// 离开（断开、关 Tab）时把还没写盘的写掉。SQL 与 Redis 的控制台共用。
// 关 Tab（与移除所在的项目或数据源）时主进程已先删掉内容，卸载时写掉的这一笔晚到，主进程不再收（见 main 的 store）。
import { useEffect, useRef, useState } from 'react'

/** 写盘前等一会儿：连续输入只写最后一次 */
const SAVE_DELAY_MS = 500

/** 控制台的内容（读到之前为 null）与改它的函数；persist 为 false 时不读也不写盘。 */
export function useConsoleText(
  tabKey: string,
  persist: boolean
): [string | null, (value: string) => void] {
  const [text, setText] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<string | null>(null)

  useEffect(() => {
    let current = true
    void (persist ? window.api.getDataSourceConsoleText(tabKey) : Promise.resolve('')).then(
      (saved) => {
        if (current) setText(saved)
      }
    )
    return () => {
      current = false
    }
  }, [tabKey, persist])

  useEffect(
    () => () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current)
      if (pendingSave.current !== null)
        void window.api.setDataSourceConsoleText(tabKey, pendingSave.current)
    },
    [tabKey]
  )

  const save = (value: string): void => {
    setText(value)
    if (!persist) return
    pendingSave.current = value
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      pendingSave.current = null
      void window.api.setDataSourceConsoleText(tabKey, value)
    }, SAVE_DELAY_MS)
  }

  return [text, save]
}
