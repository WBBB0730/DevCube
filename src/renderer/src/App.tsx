function App(): React.JSX.Element {
  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-panel">
        <div className="px-3 py-2 text-foreground">项目</div>
        <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          探测脚本
        </div>
      </aside>
      <main className="flex-1 bg-deepest p-3 font-mono text-[13px] text-[color:var(--fg-icon)]">
        Run — 控制台占位
      </main>
    </div>
  )
}

export default App
