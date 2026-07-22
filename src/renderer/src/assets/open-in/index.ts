import type { OpenInAppId } from '@shared/open-in-app'
import claude from './claude.png'
import codex from './codex.png'
import cursor from './cursor.png'

/** 「打开于」子菜单品牌图标（各桌面端 App / 官方浅色标）。 */
export const OPEN_IN_APP_ICONS: Record<OpenInAppId, string> = {
  cursor,
  codex,
  claude
}
