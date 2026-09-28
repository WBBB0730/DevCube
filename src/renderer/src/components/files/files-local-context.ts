import { createContext } from 'react'

/**
 * 面板里的文件是否在本机（项目 / 预览窗口为真，服务器为假）。服务器上的文件没有「在文件夹中显示」
 * 「在其他应用中打开」：工具栏与各预览的出错占位读它决定是否给这些入口，免得层层传参。
 */
export const FilesLocalContext = createContext(true)

/** 服务器上：下载当前打开的文件（预览出错的占位里的出口；本机与未连接时为 null）。 */
export const FilesDownloadContext = createContext<(() => void) | null>(null)
