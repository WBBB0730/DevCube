# Files Tab 媒体用自定义协议流式预览

位图与音视频都不把整文件打成 base64 经 IPC 丢给渲染进程：按魔数分流后走 `dc-media://` 特权协议（`standard` + `stream`），`protocol.handle` 里显式响应 `Range`（206 / `Content-Range` / 按区间 `createReadStream`），与 Electron 社区通用做法一致（Signal 维护者 gist、Joplin 等）；不另起 localhost HTTP。Chromium 播不了的容器（如 mkv/wmv）直接占位。同一协议也放行超大位图的瓦片缓存目录；看图渲染的分档见 ADR-0029。
