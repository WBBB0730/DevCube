// Git Tab「操作进行中」常驻状态条（PRD 操作进行中/冲突处理）：工具栏下方、仅 opInProgress
// 非空时渲染。rebase / cherry-pick / revert 给「继续 / 跳过 / 中止」，merge 只有「中止」
// （解决冲突后在提交面板正常提交收口）。继续 / 跳过点击即执行（走进行中遮罩，失败原样
// 落既有错误框——冲突未解决完时 git 的报错本身足够清楚）；中止先弹危险确认（op-abort）。
import { TriangleAlert } from 'lucide-react'
import type { GitOpInProgress } from '@shared/git'
import { gitState, useGit } from '@renderer/git-store'

/** 操作类型 → 中文名（状态条 / 中止确认 / 防误触置灰原因共用）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯常量与组件同文件导出（消费方共用文案）
export const GIT_OP_LABEL: Record<GitOpInProgress, string> = {
  rebase: '变基',
  merge: '合并',
  'cherry-pick': '拣选',
  revert: '回滚'
}

/** 防误触置灰的 hover 原因（工具栏拉取钮 / 右键菜单会撞车的项共用）。 */
// eslint-disable-next-line react-refresh/only-export-components -- 纯函数与组件同文件导出（供消费方复用）
export function opBlockReason(op: GitOpInProgress): string {
  return `${GIT_OP_LABEL[op]}进行中，请先完成或中止`
}

// 状态条小按钮：观感对齐 GitPane 错误态「重试」钮，压到 h-6 适配紧凑条高
const BAR_BTN =
  'h-6 shrink-0 rounded border border-[color:var(--border-input)] bg-panel px-2.5 text-[12px] text-foreground transition-colors hover:bg-[var(--bg-row-hover)]'

/** 状态条：数据只订阅 opInProgress，为空即不渲染（挂载点在 GitPane 工具栏之后）。 */
export function GitOpStatusBar({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const op = useGit((s) => gitState(s, projectPath).opInProgress)
  if (op === null) return null
  const label = GIT_OP_LABEL[op]
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-[color:var(--separator)] bg-panel px-3">
      <TriangleAlert className="size-4 shrink-0 text-[color:var(--status-failed)]" />
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
        {op === 'merge'
          ? '合并进行中——解决冲突后在提交面板完成提交，或中止'
          : `${label}进行中——解决冲突并暂存后继续，或中止`}
      </span>
      {op !== 'merge' && (
        <>
          <button
            type="button"
            className={BAR_BTN}
            onClick={() =>
              void useGit
                .getState()
                .runAction(projectPath, { kind: 'op-continue', op }, `正在继续${label}`)
            }
          >
            继续
          </button>
          <button
            type="button"
            className={BAR_BTN}
            onClick={() =>
              void useGit
                .getState()
                .runAction(projectPath, { kind: 'op-skip', op }, '正在跳过当前提交')
            }
          >
            跳过
          </button>
        </>
      )}
      <button
        type="button"
        className={BAR_BTN}
        onClick={() => useGit.getState().openDialog(projectPath, { kind: 'op-abort', op })}
      >
        中止
      </button>
    </div>
  )
}
