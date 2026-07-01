import { useEffect } from 'react'
import { ProjectTree } from '@renderer/components/ProjectTree'
import { useApp } from '@renderer/store'

function App(): React.JSX.Element {
  const init = useApp((s) => s.init)

  useEffect(() => {
    init()
    return window.api.onTreeChanged((tree) => useApp.getState().setTree(tree))
  }, [init])

  return (
    <div className="flex h-full">
      <ProjectTree />
      <main className="flex-1 bg-deepest" />
    </div>
  )
}

export default App
