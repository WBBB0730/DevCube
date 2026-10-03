; DevCube NSIS 附加钩子（Stable / Beta 共用；PRODUCT_NAME 随 Release Edition）。
; 右键菜单由应用设置里的「系统集成」开关经 reg.exe 管理（ADR-0025、ADR-0049）；
; 这里只在真卸载（非更新）时兜底清理，避免留下指向已卸载 exe 的菜单项。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\${PRODUCT_NAME}"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\${PRODUCT_NAME}"
    ; 「用 ${PRODUCT_NAME} 压缩」右键扩展（ADR-0049）：CLSID 从动词键里读出，连同两个动词键一并删掉；
    ; 复制到用户目录的 DLL 若仍被资源管理器占着则删不掉，留到下次登录后无人引用
    ReadRegStr $0 HKCU "Software\Classes\Directory\shell\${PRODUCT_NAME}.Compress" "ExplorerCommandHandler"
    ${if} $0 != ""
      DeleteRegKey HKCU "Software\Classes\CLSID\$0"
    ${endIf}
    DeleteRegKey HKCU "Software\Classes\*\shell\${PRODUCT_NAME}.Compress"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\${PRODUCT_NAME}.Compress"
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}\shell"
    ; 运行时 setAsDefaultProtocolClient 写的 deep link 协议键（scheme = 包名 devcube / devcube-beta）
    DeleteRegKey HKCU "Software\Classes\${APP_PACKAGE_NAME}"
  ${endIf}
!macroend
