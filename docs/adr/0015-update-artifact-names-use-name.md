# 更新制品文件名用 `${name}`，不用带空格的 productName

GitHub Release 会把资产文件名里的空格改成 `.`，而 electron-builder 写入 `latest-mac.yml` 的 url 往往把空格收成 `-`。Beta 显示名是「DevCube Beta」时，默认 mac zip 名会让「真实资产」和「更新清单」对不上，应用内更新必然下挂。决定：进 Release / 给 updater 用的文件名一律用无空格的 `${name}`（`devcube` / `devcube-beta`），与现有 Win setup/portable、dmg 一致；`productName` 仍可含空格，只负责显示。
