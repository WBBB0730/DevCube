// 「连接到服务器」的菜单项：每台已登记的服务器一项（Server 图标 + 名称，hover 显示连接目标），
// 点击即在 ownerKey 条目下开一个连到它的 SSH Terminal。项目右键菜单与 Tab 栏「+」菜单里的「连接到服务器」子菜单共用。
import { Server as ServerIcon } from 'lucide-react'
import { DropdownMenuItem } from '@renderer/components/ui/dropdown-menu'
import { useApp } from '@renderer/store'
import { serverTargetLabel } from '@shared/server'

export function ConnectServerItems({ ownerKey }: { ownerKey: string }): React.JSX.Element {
  const servers = useApp((s) => s.servers)
  const newSshTerminal = useApp((s) => s.newSshTerminal)
  return (
    <>
      {servers.map((n) => (
        <DropdownMenuItem
          key={n.server.id}
          title={serverTargetLabel(n.server.target)}
          onClick={() => void newSshTerminal(ownerKey, n.server.id)}
        >
          <ServerIcon className="size-4" />
          {n.server.name}
        </DropdownMenuItem>
      ))}
    </>
  )
}
