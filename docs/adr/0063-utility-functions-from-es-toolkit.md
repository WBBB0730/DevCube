---
status: accepted
---

# 通用工具函数用 es-toolkit，并发控制用 p-limit，不再手写

防抖原先在 IPC 里手写了一份（不能立即执行、不能取消）；窗口几何改为实时记录后（ADR-0053），又需要一个能在关窗、退出时立即执行、窗口关掉时取消的防抖。全屏切换排队与 Files 面板依次打开外部文件也各自手写了一条串行队列。

我们决定：

- **防抖、节流这类通用工具函数用 es-toolkit**，不手写。它自带 `flush()` / `cancel()`，有 CommonJS 入口，主进程按依赖外置直接加载，渲染层由 Vite 打包。
- **并发与串行控制用已有的 p-limit**：串行队列即 `pLimit(1)`，一个任务失败不影响后面的。

## Considered Options

- **lodash**：同样成熟，但体积大、按函数引入不便，es-toolkit 是它的现代替代且 API 相近，排除。
- **抽一个共享的手写工具**：仍是自己维护的轮子，边界情况（立即执行、取消、失败后继续）要自己测，排除。

## Consequences

- 新代码需要防抖、节流等通用工具时先找 es-toolkit，需要限并发或串行时用 p-limit。
- p-limit 只发布 ES 模块，主进程构建里把它排除在依赖外置之外、打进包里（`electron.vite.config.ts`）；es-toolkit 不需要。
