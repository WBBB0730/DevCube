// Data Source Tab 左侧当前显示那一格的正文焦点（docs/prd/database.md「最近打开」；同 Files 的最近打开文件：选中或 Esc 后
// 焦点回正文）：「当前对象 / 当前键」一格里的正文（表格、只读编辑器、字符串原文）与「控制台」一格的编辑器，挂载时登记
// 聚焦自己的函数、卸载时注销。登记处只由 DataSourceLayout 给当前显示的那一格（见 useDataSourceOpened），控制台的结果区
// 与别处（运行会话、对话框）的表格与编辑器没有登记处，不登记。
import { createContext, useContext, useEffect } from 'react'

/** 登记聚焦正文的函数，交回注销的函数。 */
export type ContentFocusRegister = (focus: () => void) => () => void

export const ContentFocusContext = createContext<ContentFocusRegister | null>(null)

/**
 * 在当前显示的那一格里时登记 focus：挂载时登记、卸载时注销；focus 为 null（正文还没建好，如编辑器）时不登记。focus 要
 * 保持同一个引用。
 */
export function useContentFocus(focus: (() => void) | null): void {
  const register = useContext(ContentFocusContext)
  useEffect(() => (focus === null ? undefined : register?.(focus)), [register, focus])
}
