// IPC 通道名常量，供 main 与 preload 共享，避免字符串手误。
export const IPC = {
  treeGet: 'tree:get',
  treeChanged: 'tree:changed',
  projectAdd: 'project:add',
  projectAddByPath: 'project:add-by-path',
  projectRemove: 'project:remove',
  run: 'session:run',
  stop: 'session:stop',
  stdin: 'session:stdin',
  resize: 'session:resize',
  sessionBuffer: 'session:buffer',
  sessions: 'session:list',
  sessionOutput: 'session:output',
  sessionStatus: 'session:status',
  sessionRemoved: 'session:removed',
  configCreate: 'config:create',
  configUpdate: 'config:update',
  configDelete: 'config:delete',
  configReorder: 'config:reorder',
  openExternal: 'shell:open-external'
} as const
