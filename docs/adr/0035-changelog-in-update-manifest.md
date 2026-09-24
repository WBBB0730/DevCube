# 更新日志手写在 CHANGELOG.md，整份写进更新清单随检查结果下发

应用内更新要在确认前列出「当前版本之后、到新版本为止」每一版的 **Changelog**。日志由维护者在仓库根 `CHANGELOG.md` 里手写，格式照 Keep a Changelog：一个正式版本一段，只写正式版号；Beta 不单独写，共用同号正式版那段；不强制写。打包时用 electron-builder 的 `releaseInfo.releaseNotesFile` 把整份文件写进更新清单（`latest.yml` / `latest-mac.yml`）的 `releaseNotes`。electron-updater 检查到新版本时把这段文字原样交给应用，应用自己挑出区间内的各段，比较前两端都先去掉 `-beta.N`。官方的本意是这个字段只放这一版的说明，我们放的是整份，换来的是日志和检查结果一起到：不另发请求，也不会出现「查到了版本、日志没到」的状态。

## Considered Options

- **整份写进更新清单**（选中）：不写任何网络代码，只多一行打包配置；清单里带了 `releaseNotes`，electron-updater 就不再去读 Release 订阅源。
- **electron-updater 的 `fullChangelog`**：官方的多版本日志开关，但数据来自 GitHub 的 Release 订阅源（`releases.atom`）。实测这个源每次只给最近 10 条，调条数的参数都被忽略；翻页只能靠没有文档的 `?after=`，electron-updater 也不翻页。正式版和 Beta 成对发时，10 条只够 5～6 个版本，缺了还不提示。拿到的内容也是 HTML，而且会混进另一条线的版本。
- **把 CHANGELOG.md 作为 Release 附件，应用另行下载**：多一次请求，要多管重试、缓存和「日志还没到」的状态；附件和安装包还可能不是同一次构建产出的。它和更新清单走的是同一个下载地址，换不来额外的能力。
- **从 git 提交自动生成**（changelogithub 等）：日志是给用户看的，要人来写；提交标题里混着内部改动。

## Consequences

- 更新清单会随日志变长：每版几百字节，每次检查更新都要下载一遍。写到几百个版本、嫌它太大时，再评估要不要只带最近若干版。
- 改成让 electron-builder 自己 `--publish` 时，它也会拿这段文字当 Release 正文，正文就变成了整份日志。现在由 CI 的 `gh release` 发布，正文只取这一版那段。
- 在「这一项出现之前」发布的版本，清单里没有 `releaseNotes`，electron-updater 会退回去读 Release 正文（HTML）。HTML 里没有版本标题，所以挑出来是空的。
- 功能上线的那一版本身，用户从更早的版本升级上来时看不到更新弹窗，因为弹窗代码在新版本里。补写的历史段落只出现在网页 Release 正文里，以及开发时用来测试。
- 文件里的所有内容都会随清单发出去：开发时为了本地预览临时加的「未来版本」段落，发版前要删掉。
