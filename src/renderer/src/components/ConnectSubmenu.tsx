// 「连接到服务器」/「连接到数据源」二级菜单：每个已登记的服务器 / 数据源一项（图标 + 名称，hover 显示连接目标），
// 按左树当前的排序（置顶的在前）；点击即在 ownerKey 条目下开一个连到它的 SSH Terminal / Data Source Tab 并立即连接。
// 项目右键菜单与 Tab 栏「+」菜单共用（见 docs/prd/ssh-server.md、docs/prd/database.md）：前者一个都没有时不出这一项；
// 后者（addable）总是出，末尾多一项「添加服务器…」/「添加数据源…」。
import { Database, Plus, Server as ServerIcon } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useApp, type ConnectionEntryKind } from '@renderer/store'
import { dataSourceTargetLabel } from '@shared/data-source'
import { sortTreeEntries } from '@shared/project-sort'
import { serverTargetLabel } from '@shared/server'
import { buildTreeEntries } from '@shared/tree-entry'

const SUBMENU = {
  server: { icon: ServerIcon, label: '连接到服务器', addLabel: '添加服务器…' },
  dataSource: { icon: Database, label: '连接到数据源', addLabel: '添加数据源…' }
} as const

export function ConnectSubmenu({
  kind,
  ownerKey,
  addable = false
}: {
  kind: ConnectionEntryKind
  /** 在哪个条目下开 */
  ownerKey: string
  /** 末尾给「添加…」；这时一个都没有也出这一项 */
  addable?: boolean
}): React.JSX.Element | null {
  const servers = useApp((s) => s.servers)
  const dataSources = useApp((s) => s.dataSources)
  const prefs = useApp((s) => s.projectSortPrefs)
  const newSshTerminal = useApp((s) => s.newSshTerminal)
  const newDataSourceTab = useApp((s) => s.newDataSourceTab)
  const openConnectionDialog = useApp((s) => s.openConnectionDialog)
  const entries = sortTreeEntries(
    kind === 'server' ? buildTreeEntries([], servers, []) : buildTreeEntries([], [], dataSources),
    prefs
  )
  if (entries.length === 0 && !addable) return null
  const { icon: Icon, label, addLabel } = SUBMENU[kind]
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon className="size-4" /> {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {entries.map((entry) =>
          entry.kind === 'server' ? (
            <DropdownMenuItem
              key={entry.key}
              title={serverTargetLabel(entry.node.server.target)}
              onClick={() => void newSshTerminal(ownerKey, entry.node.server.id)}
            >
              <Icon className="size-4" />
              {entry.node.server.name}
            </DropdownMenuItem>
          ) : (
            entry.kind === 'dataSource' && (
              <DropdownMenuItem
                key={entry.key}
                title={dataSourceTargetLabel(entry.node.dataSource.target)}
                onClick={() => newDataSourceTab(ownerKey, entry.node.dataSource.id)}
              >
                <Icon className="size-4" />
                {entry.node.dataSource.name}
              </DropdownMenuItem>
            )
          )
        )}
        {addable && (
          <>
            {entries.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => openConnectionDialog({ kind })}>
              <Plus className="size-4" /> {addLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
