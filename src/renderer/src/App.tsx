import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { Console } from '@renderer/components/Console'
import { ConfigDialog } from '@renderer/components/ConfigDialog'
import { useApp } from '@renderer/store'

function App(): React.JSX.Element {
  const init = useApp((s) => s.init)
  const dialog = useApp((s) => s.dialog)

  useEffect(() => {
    init()
    const offTree = window.api.onTreeChanged((tree) => useApp.getState().setTree(tree))
    const offStatus = window.api.onSessionStatus((s) => useApp.getState().setSession(s))
    const offRemoved = window.api.onSessionRemoved((key) => useApp.getState().removeSession(key))
    return () => {
      offTree()
      offStatus()
      offRemoved()
    }
  }, [init])

  return (
    <>
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="22%" minSize="14%" maxSize="40%">
          <ProjectTree />
        </Panel>
        <Separator className="group relative flex w-1.5 items-stretch justify-center">
          <div className="w-px bg-[var(--separator)] transition-colors group-hover:bg-[var(--selection-row)]" />
        </Separator>
        <Panel>
          <Console />
        </Panel>
      </Group>
      {dialog.open && <ConfigDialog key={dialog.config?.id ?? 'new'} />}
    </>
  )
}

export default App
