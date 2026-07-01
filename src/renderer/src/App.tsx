import { useEffect } from 'react'
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
    <div className="flex h-full">
      <ProjectTree />
      <Console />
      {dialog.open && <ConfigDialog key={dialog.config?.id ?? 'new'} />}
    </div>
  )
}

export default App
