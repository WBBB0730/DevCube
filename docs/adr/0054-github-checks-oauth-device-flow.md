# Git Tab 经 DevCube 自己的 GitHub OAuth App、以设备授权登录后查提交检查

Git Tab 要显示提交在 GitHub 上的检查结果（**Check**：Actions 的作业、其他服务报回的检查与提交状态），就得在 `git fetch` 之外第一次主动调用 GitHub 接口，而且私有仓库必须带用户的凭证。我们决定：DevCube 在 GitHub 上登记一个 OAuth App，用户在设置的「账号」栏（或 Git Tab 工具栏的「登录 GitHub」）点「登录」走**设备授权**（DevCube 显示一串短码并复制，用户点开 github.com/login/device 粘贴、授权；GitHub 不支持带代码预填）；拿到的凭证用 Electron `safeStorage` 加密后存进集中配置（ADR-0002），只在主进程解密使用、不下发渲染端。查询用 GraphQL 的 `statusCheckRollup`（一次请求带上百个提交的别名），请求一律走 Electron 的 `net.fetch`，跟随系统代理。客户端用 GitHub 官方的 Octokit（`@octokit/auth-oauth-device`、`@octokit/graphql`、`@octokit/request`）。

## Considered Options

- **设备授权 + 普通 OAuth App（选中）**：只要一个可以公开的 client ID，不需要密钥、不需要本机回调端口；用户在 DevCube 里多一步「粘贴短码」。代价是 OAuth App 读私有仓库的检查只能申请 `repo`（GitHub 的 Checks API 对 OAuth 凭证的要求），授权页会写「完全控制私有仓库」；组织开了第三方应用限制时，要组织管理员批准后才查得到该组织的仓库。
- **浏览器授权后跳回本机（Web 流程 + 本机回调）**：用户只点一次「授权」。但用授权码换凭证必须带 client secret，即使加了 PKCE 也一样；密钥装进安装包等于公开，别人可以冒充 DevCube 骗用户授权；要真正保密只能另架一台服务器中转。
- **GitHub App**：可以只要「读检查结果」这类细粒度只读权限。但用户授权后还得把 App 安装到账号、勾选仓库，组织仓库要由组织管理员安装，流程最长。
- **借用本机的 `gh` 命令行或 git 凭据助手里的凭证**：DevCube 是分发给所有用户的应用，不能假定用户装了、登录了 `gh`；SSH 远程的用户在凭据助手里也拿不到 GitHub 凭证，而且把推代码用的凭证拿去调接口超出了它的用途。
- **让用户粘贴个人访问令牌**：最通用，但要用户自己去 GitHub 设置页生成、挑权限、复制，步骤最多，也最容易给出过宽的令牌。

## Consequences

- 只认 github.com 上的仓库；GitHub Enterprise、GitLab 等不在范围内。认仓库靠 `git remote -v` 的获取地址（已按 `insteadOf` 改写），origin 优先；`~/.ssh/config` 里的 SSH 主机别名（如 `github-work`）认不出。
- 退出登录只删掉本机保存的凭证，不在 GitHub 上吊销授权（吊销需要 client secret）；用户可在 GitHub 设置的已授权应用里自行撤销。凭证被拒（401）或解不开时自动退出登录。
- Linux 上 `safeStorage` 没有可用的系统钥匙串时不能登录（同「记住密码」，ADR-0038）。
- client ID 写在主进程代码里，跟随安装包分发；换 OAuth App 要发版。
- 未登录时不发出任何 GitHub 请求，Git Tab 与此前完全一致；查询失败一律静默，不打断 Git Tab。
- Octokit 是纯 ESM，主进程（CJS 产物）以动态 import 加载，与 electron-store 同法；三个包放 `dependencies`（ADR-0036）。
