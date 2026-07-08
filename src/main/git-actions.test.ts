import { describe, expect, it } from 'vitest'
import {
  buildAddRemoteArgs,
  buildAddTagArgs,
  buildCheckoutBranchArgs,
  buildCheckoutCommitArgs,
  buildCherrypickArgs,
  buildCleanUntrackedArgs,
  buildCommitArgs,
  buildCreateBranchArgs,
  buildDeleteBranchArgs,
  buildDeleteRemoteArgs,
  buildDeleteRemoteBranchArgs,
  buildDeleteRemoteTrackingBranchArgs,
  buildDeleteTagArgs,
  buildDeleteUntrackedFileArgs,
  buildDiscardFileArgs,
  buildDropCommitArgs,
  buildEditRemoteArgs,
  buildFetchArgs,
  buildFetchIntoLocalArgs,
  buildMergeArgs,
  buildPruneRemoteArgs,
  buildPullBranchArgs,
  buildPushBranchArgs,
  buildPushTagArgs,
  buildPushTagCheckArgs,
  buildRebaseArgs,
  buildRenameBranchArgs,
  buildResetArgs,
  buildResetFileArgs,
  buildRevertArgs,
  buildSetConfigArgs,
  buildSquashCommitArgs,
  buildSquashMessage,
  buildStagePathsArgs,
  buildStashApplyArgs,
  buildStashBranchArgs,
  buildStashDropArgs,
  buildStashPopArgs,
  buildStashPushArgs,
  buildUnsetConfigArgs,
  buildUnstagePathsArgs,
  buildInitArgs,
  buildVersionGateError,
  findRemotesMissingCommit,
  parseGitVersion,
  toActionResult
} from './git-actions'

describe('buildInitArgs', () => {
  it('两个字段都空时只有一条裸 init（尊重 init.defaultBranch）', () => {
    expect(buildInitArgs({ kind: 'init', branchName: null, remoteUrl: null })).toEqual([['init']])
  })
  it('填了分支名时 init -b（所见即所得）', () => {
    expect(buildInitArgs({ kind: 'init', branchName: 'main', remoteUrl: null })).toEqual([
      ['init', '-b', 'main']
    ])
  })
  it('填了远程地址时串联 remote add origin（fetch 不在序列内，失败不算 init 失败）', () => {
    expect(
      buildInitArgs({ kind: 'init', branchName: null, remoteUrl: 'git@host:a/b.git' })
    ).toEqual([['init'], ['remote', 'add', 'origin', 'git@host:a/b.git']])
  })
  it('分支名与远程地址都填时按 init -b → remote add 顺序', () => {
    expect(
      buildInitArgs({ kind: 'init', branchName: 'trunk', remoteUrl: 'https://host/a/b.git' })
    ).toEqual([
      ['init', '-b', 'trunk'],
      ['remote', 'add', 'origin', 'https://host/a/b.git']
    ])
  })
})

describe('buildCheckoutBranchArgs', () => {
  it('检出已有本地分支时只有分支名', () => {
    expect(
      buildCheckoutBranchArgs({ kind: 'checkout-branch', branch: 'dev', remoteBranch: null })
    ).toEqual([['checkout', 'dev']])
  })
  it('从远程分支创建并检出时用 -b 并带远程分支名', () => {
    expect(
      buildCheckoutBranchArgs({
        kind: 'checkout-branch',
        branch: 'dev',
        remoteBranch: 'origin/dev'
      })
    ).toEqual([['checkout', '-b', 'dev', 'origin/dev']])
  })
})

describe('buildCreateBranchArgs', () => {
  it('检出且非 force 时合并为一条 checkout -b', () => {
    expect(
      buildCreateBranchArgs({
        kind: 'create-branch',
        hash: 'abc123',
        name: 'dev',
        checkout: true,
        force: false
      })
    ).toEqual([['checkout', '-b', 'dev', 'abc123']])
  })
  it('不检出时只有一条 branch 命令', () => {
    expect(
      buildCreateBranchArgs({
        kind: 'create-branch',
        hash: 'abc123',
        name: 'dev',
        checkout: false,
        force: false
      })
    ).toEqual([['branch', 'dev', 'abc123']])
  })
  it('force 时 branch 带 -f', () => {
    expect(
      buildCreateBranchArgs({
        kind: 'create-branch',
        hash: 'abc123',
        name: 'dev',
        checkout: false,
        force: true
      })
    ).toEqual([['branch', '-f', 'dev', 'abc123']])
  })
  it('检出且 force 时先 branch -f 再单独检出，共两条命令', () => {
    expect(
      buildCreateBranchArgs({
        kind: 'create-branch',
        hash: 'abc123',
        name: 'dev',
        checkout: true,
        force: true
      })
    ).toEqual([
      ['branch', '-f', 'dev', 'abc123'],
      ['checkout', 'dev']
    ])
  })
})

describe('buildDeleteBranchArgs', () => {
  it('非 force 用 -d', () => {
    expect(
      buildDeleteBranchArgs({
        kind: 'delete-branch',
        name: 'dev',
        force: false,
        deleteOnRemotes: []
      })
    ).toEqual([['branch', '-d', 'dev']])
  })
  it('force 用 -D', () => {
    expect(
      buildDeleteBranchArgs({
        kind: 'delete-branch',
        name: 'dev',
        force: true,
        deleteOnRemotes: ['origin']
      })
    ).toEqual([['branch', '-D', 'dev']])
  })
})

describe('buildDeleteRemoteBranchArgs', () => {
  it('用 push --delete 删除远程分支', () => {
    expect(
      buildDeleteRemoteBranchArgs({ kind: 'delete-remote-branch', branch: 'dev', remote: 'origin' })
    ).toEqual([['push', 'origin', '--delete', 'dev']])
  })
})

describe('buildDeleteRemoteTrackingBranchArgs', () => {
  it('降级命令删除本地的远程跟踪分支', () => {
    expect(buildDeleteRemoteTrackingBranchArgs('origin', 'dev')).toEqual([
      'branch',
      '-d',
      '-r',
      'origin/dev'
    ])
  })
})

describe('buildRenameBranchArgs', () => {
  it('用 branch -m 旧名 新名', () => {
    expect(
      buildRenameBranchArgs({ kind: 'rename-branch', oldName: 'old', newName: 'new' })
    ).toEqual([['branch', '-m', 'old', 'new']])
  })
})

describe('buildMergeArgs', () => {
  it('无选项时只有对象名', () => {
    expect(
      buildMergeArgs({
        kind: 'merge',
        obj: 'dev',
        on: 'branch',
        noFastForward: false,
        squash: false,
        noCommit: false
      })
    ).toEqual([['merge', 'dev']])
  })
  it('squash 与 noFastForward 同为 true 时 squash 优先，不出现 --no-ff', () => {
    expect(
      buildMergeArgs({
        kind: 'merge',
        obj: 'dev',
        on: 'branch',
        noFastForward: true,
        squash: true,
        noCommit: false
      })
    ).toEqual([['merge', 'dev', '--squash']])
  })
  it('仅 noFastForward 时加 --no-ff', () => {
    expect(
      buildMergeArgs({
        kind: 'merge',
        obj: 'dev',
        on: 'branch',
        noFastForward: true,
        squash: false,
        noCommit: false
      })
    ).toEqual([['merge', 'dev', '--no-ff']])
  })
  it('noCommit 可与 squash 叠加', () => {
    expect(
      buildMergeArgs({
        kind: 'merge',
        obj: 'dev',
        on: 'branch',
        noFastForward: false,
        squash: true,
        noCommit: true
      })
    ).toEqual([['merge', 'dev', '--squash', '--no-commit']])
  })
})

describe('buildRebaseArgs', () => {
  it('非交互 rebase 只带对象名', () => {
    expect(
      buildRebaseArgs({ kind: 'rebase', obj: 'main', on: 'branch', ignoreDate: false })
    ).toEqual([['rebase', 'main']])
  })
  it('ignoreDate 时追加 --ignore-date', () => {
    expect(
      buildRebaseArgs({ kind: 'rebase', obj: 'main', on: 'branch', ignoreDate: true })
    ).toEqual([['rebase', 'main', '--ignore-date']])
  })
})

describe('buildDropCommitArgs', () => {
  it('用 rebase --onto <hash>^ <hash> 抹掉提交', () => {
    expect(buildDropCommitArgs({ kind: 'drop-commit', hash: 'abc123' })).toEqual([
      ['rebase', '--onto', 'abc123^', 'abc123']
    ])
  })
})

describe('buildCheckoutCommitArgs', () => {
  it('直接检出提交哈希', () => {
    expect(buildCheckoutCommitArgs({ kind: 'checkout-commit', hash: 'abc123' })).toEqual([
      ['checkout', 'abc123']
    ])
  })
})

describe('buildCherrypickArgs', () => {
  it('普通提交（parentIndex 0）不加 -m', () => {
    expect(
      buildCherrypickArgs({
        kind: 'cherrypick',
        hash: 'abc123',
        parentIndex: 0,
        recordOrigin: false,
        noCommit: false
      })
    ).toEqual([['cherry-pick', 'abc123']])
  })
  it('选项顺序固定为 --no-commit、-x、-m、hash', () => {
    expect(
      buildCherrypickArgs({
        kind: 'cherrypick',
        hash: 'abc123',
        parentIndex: 1,
        recordOrigin: true,
        noCommit: true
      })
    ).toEqual([['cherry-pick', '--no-commit', '-x', '-m', '1', 'abc123']])
  })
})

describe('buildRevertArgs', () => {
  it('恒带 --no-edit，普通提交不加 -m', () => {
    expect(buildRevertArgs({ kind: 'revert', hash: 'abc123', parentIndex: 0 })).toEqual([
      ['revert', '--no-edit', 'abc123']
    ])
  })
  it('合并提交带 -m <父序号>', () => {
    expect(buildRevertArgs({ kind: 'revert', hash: 'abc123', parentIndex: 2 })).toEqual([
      ['revert', '--no-edit', '-m', '2', 'abc123']
    ])
  })
})

describe('buildResetArgs', () => {
  it('模式拼为 --soft/--mixed/--hard', () => {
    expect(buildResetArgs({ kind: 'reset', hash: 'abc123', mode: 'soft' })).toEqual([
      ['reset', '--soft', 'abc123']
    ])
    expect(buildResetArgs({ kind: 'reset', hash: 'abc123', mode: 'hard' })).toEqual([
      ['reset', '--hard', 'abc123']
    ])
  })
})

describe('buildResetFileArgs', () => {
  it('文件路径作为 -- 之后的独立参数', () => {
    expect(
      buildResetFileArgs({ kind: 'reset-file', hash: 'abc123', filePath: 'src/a b.ts' })
    ).toEqual([['checkout', 'abc123', '--', 'src/a b.ts']])
  })
})

describe('buildCleanUntrackedArgs', () => {
  it('不含目录时只有 -f', () => {
    expect(buildCleanUntrackedArgs({ kind: 'clean-untracked', directories: false })).toEqual([
      ['clean', '-f']
    ])
  })
  it('含目录时是单个参数 -fd 而不是两个', () => {
    expect(buildCleanUntrackedArgs({ kind: 'clean-untracked', directories: true })).toEqual([
      ['clean', '-fd']
    ])
  })
})

describe('buildStagePathsArgs', () => {
  it('空 paths 时全部暂存（add -A）', () => {
    expect(buildStagePathsArgs({ kind: 'stage-paths', paths: [] })).toEqual([['add', '-A']])
  })
  it('非空 paths 追加在 -- 之后，含空格路径原样成段', () => {
    expect(buildStagePathsArgs({ kind: 'stage-paths', paths: ['src/a b.ts', 'x.txt'] })).toEqual([
      ['add', '-A', '--', 'src/a b.ts', 'x.txt']
    ])
  })
  it('R 双路径场景由调用方传旧新两个路径，构造层原样透传', () => {
    expect(
      buildStagePathsArgs({ kind: 'stage-paths', paths: ['src/old.ts', 'src/new.ts'] })
    ).toEqual([['add', '-A', '--', 'src/old.ts', 'src/new.ts']])
  })
})

describe('buildUnstagePathsArgs', () => {
  it('空 paths 时全部取消暂存（reset -q）', () => {
    expect(buildUnstagePathsArgs({ kind: 'unstage-paths', paths: [] })).toEqual([['reset', '-q']])
  })
  it('非空 paths 追加在 -- 之后，含空格路径原样成段', () => {
    expect(buildUnstagePathsArgs({ kind: 'unstage-paths', paths: ['src/a b.ts'] })).toEqual([
      ['reset', '-q', '--', 'src/a b.ts']
    ])
  })
})

describe('buildDiscardFileArgs', () => {
  it('不带提交参数，从 index 恢复工作区（区别于 reset-file 的从提交恢复）', () => {
    expect(buildDiscardFileArgs({ kind: 'discard-file', paths: ['src/a b.ts'] })).toEqual([
      ['checkout', '--', 'src/a b.ts']
    ])
  })

  it('多文件一条 checkout 覆盖全部路径', () => {
    expect(buildDiscardFileArgs({ kind: 'discard-file', paths: ['a.ts', 'b.ts'] })).toEqual([
      ['checkout', '--', 'a.ts', 'b.ts']
    ])
  })
})

describe('buildDeleteUntrackedFileArgs', () => {
  it('用 clean -fd 删除单个未跟踪文件（-d 覆盖未跟踪目录条目）', () => {
    expect(
      buildDeleteUntrackedFileArgs({ kind: 'delete-untracked-file', paths: ['new file.txt'] })
    ).toEqual([['clean', '-fd', '--', 'new file.txt']])
  })

  it('多文件一条 clean 删除全部路径', () => {
    expect(
      buildDeleteUntrackedFileArgs({ kind: 'delete-untracked-file', paths: ['x.log', 'y.log'] })
    ).toEqual([['clean', '-fd', '--', 'x.log', 'y.log']])
  })
})

describe('buildCommitArgs', () => {
  it('普通提交为 commit -m', () => {
    expect(buildCommitArgs({ kind: 'commit', message: '修复问题', amend: false })).toEqual([
      ['commit', '-m', '修复问题']
    ])
  })
  it('amend 时带 --amend', () => {
    expect(buildCommitArgs({ kind: 'commit', message: '修正上次提交', amend: true })).toEqual([
      ['commit', '--amend', '-m', '修正上次提交']
    ])
  })
  it('消息含换行时在单个 argv 段内原样保留', () => {
    expect(
      buildCommitArgs({ kind: 'commit', message: '主题\n\n正文第一行', amend: false })
    ).toEqual([['commit', '-m', '主题\n\n正文第一行']])
  })
})

describe('buildFetchArgs', () => {
  it('remote 为 null 时抓取全部（--all）', () => {
    expect(
      buildFetchArgs({ kind: 'fetch', remote: null, prune: false, pruneTags: false }, false)
    ).toEqual([['fetch', '--all']])
  })
  it('指定远程并按序追加 --prune 与 --prune-tags', () => {
    expect(
      buildFetchArgs({ kind: 'fetch', remote: 'origin', prune: true, pruneTags: true }, false)
    ).toEqual([['fetch', 'origin', '--prune', '--prune-tags']])
  })
  it('atomic（git ≥ 2.31）时紧跟 remote 追加 --atomic，引用更新事务化', () => {
    expect(
      buildFetchArgs({ kind: 'fetch', remote: 'origin', prune: true, pruneTags: false }, true)
    ).toEqual([['fetch', 'origin', '--atomic', '--prune']])
  })
})

describe('buildPushBranchArgs', () => {
  it('每个远程生成一条命令，flag 在分支名之后', () => {
    expect(
      buildPushBranchArgs({
        kind: 'push-branch',
        branch: 'dev',
        remotes: ['origin', 'upstream'],
        setUpstream: true,
        mode: 'force-with-lease'
      })
    ).toEqual([
      ['push', 'origin', 'dev', '--set-upstream', '--force-with-lease'],
      ['push', 'upstream', 'dev', '--set-upstream', '--force-with-lease']
    ])
  })
  it('normal 模式不追加 force flag', () => {
    expect(
      buildPushBranchArgs({
        kind: 'push-branch',
        branch: 'dev',
        remotes: ['origin'],
        setUpstream: false,
        mode: 'normal'
      })
    ).toEqual([['push', 'origin', 'dev']])
  })
})

describe('buildFetchIntoLocalArgs', () => {
  it('远程分支与本地分支以冒号连接', () => {
    expect(
      buildFetchIntoLocalArgs({
        kind: 'fetch-into-local',
        remote: 'origin',
        remoteBranch: 'main',
        localBranch: 'main',
        force: false
      })
    ).toEqual([['fetch', 'origin', 'main:main']])
  })
  it('force 时 -f 在远程名之前', () => {
    expect(
      buildFetchIntoLocalArgs({
        kind: 'fetch-into-local',
        remote: 'origin',
        remoteBranch: 'main',
        localBranch: 'dev',
        force: true
      })
    ).toEqual([['fetch', '-f', 'origin', 'main:dev']])
  })
})

describe('buildPullBranchArgs', () => {
  it('squash 优先于 noFastForward', () => {
    expect(
      buildPullBranchArgs({
        kind: 'pull-branch',
        remote: 'origin',
        branch: 'main',
        noFastForward: true,
        squash: true
      })
    ).toEqual([['pull', 'origin', 'main', '--squash']])
  })
  it('仅 noFastForward 时加 --no-ff', () => {
    expect(
      buildPullBranchArgs({
        kind: 'pull-branch',
        remote: 'origin',
        branch: 'main',
        noFastForward: true,
        squash: false
      })
    ).toEqual([['pull', 'origin', 'main', '--no-ff']])
  })
})

describe('buildAddTagArgs', () => {
  it('轻量标签只有标签名，忽略 message', () => {
    expect(
      buildAddTagArgs({
        kind: 'add-tag',
        hash: 'abc123',
        name: 'v1.0',
        type: 'lightweight',
        message: '忽略我',
        force: false,
        pushToRemote: null,
        skipRemoteCheck: false
      })
    ).toEqual([['tag', 'v1.0', 'abc123']])
  })
  it('注释标签用 -a 与 -m，哈希在末尾', () => {
    expect(
      buildAddTagArgs({
        kind: 'add-tag',
        hash: 'abc123',
        name: 'v1.0',
        type: 'annotated',
        message: '发布 1.0',
        force: false,
        pushToRemote: null,
        skipRemoteCheck: false
      })
    ).toEqual([['tag', '-a', 'v1.0', '-m', '发布 1.0', 'abc123']])
  })
  it('force 时 -f 在最前', () => {
    expect(
      buildAddTagArgs({
        kind: 'add-tag',
        hash: 'abc123',
        name: 'v1.0',
        type: 'lightweight',
        message: '',
        force: true,
        pushToRemote: null,
        skipRemoteCheck: false
      })
    ).toEqual([['tag', '-f', 'v1.0', 'abc123']])
  })
})

describe('buildDeleteTagArgs', () => {
  it('不删远程时只有本地删除一条命令', () => {
    expect(buildDeleteTagArgs({ kind: 'delete-tag', name: 'v1.0', deleteOnRemote: null })).toEqual([
      ['tag', '-d', 'v1.0']
    ])
  })
  it('删远程时先推送删除再删本地', () => {
    expect(
      buildDeleteTagArgs({ kind: 'delete-tag', name: 'v1.0', deleteOnRemote: 'origin' })
    ).toEqual([
      ['push', 'origin', '--delete', 'v1.0'],
      ['tag', '-d', 'v1.0']
    ])
  })
})

describe('buildPushTagArgs', () => {
  it('每个远程一条 push 命令', () => {
    expect(
      buildPushTagArgs({
        kind: 'push-tag',
        name: 'v1.0',
        remotes: ['origin', 'upstream'],
        commitHash: 'abc123',
        skipRemoteCheck: true
      })
    ).toEqual([
      ['push', 'origin', 'v1.0'],
      ['push', 'upstream', 'v1.0']
    ])
  })
})

describe('buildPushTagCheckArgs', () => {
  it('预检命令列出包含该提交的远程跟踪分支', () => {
    expect(buildPushTagCheckArgs('abc123')).toEqual([
      'branch',
      '-r',
      '--no-color',
      '--contains=abc123'
    ])
  })
})

describe('buildStashPushArgs', () => {
  it('空消息不加 --message', () => {
    expect(
      buildStashPushArgs({ kind: 'stash-push', message: '', includeUntracked: false })
    ).toEqual([['stash', 'push']])
  })
  it('带消息与未跟踪文件时按序追加选项', () => {
    expect(
      buildStashPushArgs({ kind: 'stash-push', message: '进行中', includeUntracked: true })
    ).toEqual([['stash', 'push', '--include-untracked', '--message', '进行中']])
  })
})

describe('buildStashApplyArgs', () => {
  it('--index 在 selector 之前', () => {
    expect(
      buildStashApplyArgs({ kind: 'stash-apply', selector: 'stash@{0}', reinstateIndex: true })
    ).toEqual([['stash', 'apply', '--index', 'stash@{0}']])
  })
  it('不还原暂存区时无 --index', () => {
    expect(
      buildStashApplyArgs({ kind: 'stash-apply', selector: 'stash@{2}', reinstateIndex: false })
    ).toEqual([['stash', 'apply', 'stash@{2}']])
  })
})

describe('buildStashPopArgs', () => {
  it('--index 在 selector 之前', () => {
    expect(
      buildStashPopArgs({ kind: 'stash-pop', selector: 'stash@{0}', reinstateIndex: true })
    ).toEqual([['stash', 'pop', '--index', 'stash@{0}']])
  })
})

describe('buildStashDropArgs', () => {
  it('用 selector 删除贮藏', () => {
    expect(buildStashDropArgs({ kind: 'stash-drop', selector: 'stash@{1}' })).toEqual([
      ['stash', 'drop', 'stash@{1}']
    ])
  })
})

describe('buildStashBranchArgs', () => {
  it('分支名在 selector 之前', () => {
    expect(
      buildStashBranchArgs({ kind: 'stash-branch', selector: 'stash@{0}', branchName: 'fix' })
    ).toEqual([['stash', 'branch', 'fix', 'stash@{0}']])
  })
})

describe('buildAddRemoteArgs', () => {
  it('仅添加时只有一条 remote add', () => {
    expect(
      buildAddRemoteArgs({
        kind: 'add-remote',
        name: 'origin',
        url: 'git@a:b.git',
        pushUrl: null,
        fetchAfter: false
      })
    ).toEqual([['remote', 'add', 'origin', 'git@a:b.git']])
  })
  it('带 pushUrl 与 fetchAfter 时按序追加 set-url --push 与 fetch', () => {
    expect(
      buildAddRemoteArgs({
        kind: 'add-remote',
        name: 'origin',
        url: 'git@a:b.git',
        pushUrl: 'git@a:c.git',
        fetchAfter: true
      })
    ).toEqual([
      ['remote', 'add', 'origin', 'git@a:b.git'],
      ['remote', 'set-url', 'origin', '--push', 'git@a:c.git'],
      ['fetch', 'origin']
    ])
  })
})

describe('buildDeleteRemoteArgs', () => {
  it('用 remote remove 删除远程', () => {
    expect(buildDeleteRemoteArgs({ kind: 'delete-remote', name: 'origin' })).toEqual([
      ['remote', 'remove', 'origin']
    ])
  })
})

describe('buildEditRemoteArgs', () => {
  it('什么都没变时不产生任何命令', () => {
    expect(
      buildEditRemoteArgs({
        kind: 'edit-remote',
        nameOld: 'origin',
        nameNew: 'origin',
        urlOld: 'u',
        urlNew: 'u',
        pushUrlOld: null,
        pushUrlNew: null
      })
    ).toEqual([])
  })
  it('重命名后 set-url 使用新名字', () => {
    expect(
      buildEditRemoteArgs({
        kind: 'edit-remote',
        nameOld: 'origin',
        nameNew: 'up',
        urlOld: 'a',
        urlNew: 'b',
        pushUrlOld: null,
        pushUrlNew: null
      })
    ).toEqual([
      ['remote', 'rename', 'origin', 'up'],
      ['remote', 'set-url', 'up', 'b', 'a']
    ])
  })
  it('删 URL 用 --delete 旧值', () => {
    expect(
      buildEditRemoteArgs({
        kind: 'edit-remote',
        nameOld: 'origin',
        nameNew: 'origin',
        urlOld: 'a',
        urlNew: null,
        pushUrlOld: null,
        pushUrlNew: null
      })
    ).toEqual([['remote', 'set-url', 'origin', '--delete', 'a']])
  })
  it('新增 pushUrl 用 --add 新值', () => {
    expect(
      buildEditRemoteArgs({
        kind: 'edit-remote',
        nameOld: 'origin',
        nameNew: 'origin',
        urlOld: 'a',
        urlNew: 'a',
        pushUrlOld: null,
        pushUrlNew: 'p'
      })
    ).toEqual([['remote', 'set-url', '--push', 'origin', '--add', 'p']])
  })
})

describe('buildPruneRemoteArgs', () => {
  it('用 remote prune 清理失效分支', () => {
    expect(buildPruneRemoteArgs({ kind: 'prune-remote', name: 'origin' })).toEqual([
      ['remote', 'prune', 'origin']
    ])
  })
})

describe('buildSetConfigArgs', () => {
  it('location 拼为 --local/--global', () => {
    expect(
      buildSetConfigArgs({
        kind: 'set-config',
        key: 'user.name',
        value: '张三',
        location: 'global'
      })
    ).toEqual([['config', '--global', 'user.name', '张三']])
  })
})

describe('buildUnsetConfigArgs', () => {
  it('用 --unset-all 删除配置键', () => {
    expect(
      buildUnsetConfigArgs({ kind: 'unset-config', key: 'user.email', location: 'local' })
    ).toEqual([['config', '--local', '--unset-all', 'user.email']])
  })
})

describe('buildSquashMessage', () => {
  it('三种对象类型生成对应的英文合并消息', () => {
    expect(buildSquashMessage('dev', 'branch')).toBe("Merge branch 'dev'")
    expect(buildSquashMessage('origin/dev', 'remote-tracking')).toBe(
      "Merge remote-tracking branch 'origin/dev'"
    )
    expect(buildSquashMessage('abc123', 'commit')).toBe("Merge commit 'abc123'")
  })
})

describe('buildSquashCommitArgs', () => {
  it('生成带自动消息的 commit 命令', () => {
    expect(buildSquashCommitArgs('dev', 'branch')).toEqual(['commit', '-m', "Merge branch 'dev'"])
  })
})

describe('parseGitVersion', () => {
  it('去掉前缀 "git version " 并 trim', () => {
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)\n')).toBe('2.39.5 (Apple Git-154)')
    expect(parseGitVersion('git version 2.17.0\n')).toBe('2.17.0')
  })
})

describe('buildVersionGateError', () => {
  it('文案包含功能名、要求版本与当前版本', () => {
    const msg = buildVersionGateError('stash push', '2.13.2', '2.11.0')
    expect(msg).toContain('stash push')
    expect(msg).toContain('2.13.2')
    expect(msg).toContain('2.11.0')
  })
})

describe('findRemotesMissingCommit', () => {
  // 真实的 `git branch -r --no-color --contains` 输出：两个前导空格 + 分支名，含 HEAD 箭头行
  const stdout =
    '  origin/HEAD -> origin/main\n' + '  origin/main\n' + '  origin/dev\n' + '  upstream/main\n'

  it('所有远程都包含该提交时返回空数组', () => {
    expect(findRemotesMissingCommit(stdout, ['origin', 'upstream'])).toEqual([])
  })
  it('缺失的远程被找出', () => {
    expect(findRemotesMissingCommit(stdout, ['origin', 'fork'])).toEqual(['fork'])
  })
  it('HEAD 箭头行取箭头之前的分支名', () => {
    // 只有箭头行时，origin/HEAD 也以 "origin/" 为前缀，视为 origin 包含该提交
    expect(findRemotesMissingCommit('  origin/HEAD -> origin/main\n', ['origin'])).toEqual([])
  })
  it('括号包裹的 detached 描述行被忽略', () => {
    expect(findRemotesMissingCommit('  (HEAD detached at abc1234)\n', ['origin'])).toEqual([
      'origin'
    ])
  })
  it('空输出时全部远程都缺失', () => {
    expect(findRemotesMissingCommit('', ['origin', 'upstream'])).toEqual(['origin', 'upstream'])
  })
})

describe('toActionResult', () => {
  it('全部成功归并为 ok', () => {
    expect(toActionResult([null, null])).toEqual({ status: 'ok' })
  })
  it('空序列也视为成功', () => {
    expect(toActionResult([])).toEqual({ status: 'ok' })
  })
  it('收集所有非 null 错误', () => {
    expect(toActionResult([null, '错误一', '错误二'])).toEqual({
      status: 'error',
      errors: ['错误一', '错误二']
    })
  })
})
