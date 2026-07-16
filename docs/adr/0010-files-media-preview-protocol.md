# Files Tab 音视频用自定义协议流式预览

Files Tab 已有图片 data URL 预览，但音视频整文件进 base64 会爆内存且无法 Range 寻址。我们用 `file-type` + `@file-type/av` 按魔数分流，可播 MIME 走 `dc-media://` 自定义特权协议（`standard` + `stream`），在 `protocol.handle` 里显式响应 `Range`（206 / `Content-Range` / 按区间 `createReadStream`），与 Electron 社区通用做法一致（Signal 维护者 gist、Joplin 等）；不另起 localhost HTTP。Chromium 播不了的容器（如 mkv/wmv）直接占位。
