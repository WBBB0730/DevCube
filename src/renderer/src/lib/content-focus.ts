// 正文焦点的登记（Data Source Tab 与 Files 面板共用）：一格里的正文挂载时登记聚焦自己的函数、卸载时注销，宿主据此
// 把焦点交给当前显示的正文，不必知道正文是什么。
// - Data Source Tab（docs/prd/database.md「最近打开」）：「当前对象 / 当前键」一格里的正文（表格、只读编辑器、字符串原文）
//   与「控制台」一格的编辑器；登记处只由 DataSourceLayout 给当前显示的那一格（见 useDataSourceOpened），控制台的结果区
//   与别处（运行会话、对话框）的表格与编辑器没有登记处，不登记。
// - Files 面板（docs/prd/files-tab.md「按键归属」）：每栏一个登记处，「进得去」的正文（文本编辑器、表格、PDF / PPT、
//   Markdown 预览）登记，进入正文即调它；看图、音视频不分里外，不登记。
import { createContext, useContext, useEffect } from 'react'

/**
 * Files 面板里「进得去」的正文在自己的根上标这个属性（文本编辑器、表格、PDF / PPT、Markdown 预览、SQLite 视图）：
 * 焦点在里面即进了正文，Files 面板的按键归属看它（lib/files-key-guards）。看图与音视频不分里外，不标。
 */
export const CONTENT_ATTR = { 'data-content': '' } as const

/** 登记聚焦正文的函数，交回注销的函数。 */
export type ContentFocusRegister = (focus: () => void) => () => void

export const ContentFocusContext = createContext<ContentFocusRegister | null>(null)

/**
 * 在登记处之内时登记 focus：挂载时登记、卸载时注销；focus 为 null（正文还没建好，如编辑器）时不登记。focus 要
 * 保持同一个引用。
 */
export function useContentFocus(focus: (() => void) | null): void {
  const register = useContext(ContentFocusContext)
  useEffect(() => (focus === null ? undefined : register?.(focus)), [register, focus])
}
