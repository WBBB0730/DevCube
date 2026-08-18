; DevCube NSIS 附加钩子（Stable / Beta 共用；PRODUCT_NAME 随 Release Edition）。
; 右键菜单由应用设置里的「系统集成」开关经 reg.exe 管理（ADR-0025）；
; 这里只在真卸载（非更新）时兜底清理，避免留下指向已卸载 exe 的菜单项。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\${PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\${PRODUCT_NAME}"
    ; 运行时 setAsDefaultProtocolClient 写的 deep link 协议键（scheme = 包名 devcube / devcube-beta）
    DeleteRegKey HKCU "Software\Classes\${APP_PACKAGE_NAME}"
  ${endIf}
!macroend
