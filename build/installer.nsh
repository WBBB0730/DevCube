; DevCube NSIS 附加钩子（Stable / Beta 共用；PRODUCT_NAME 随 Release Edition）。
; 右键菜单由应用设置里的「系统集成」开关经 reg.exe 管理（ADR-0025、ADR-0049），
; 「文件打开方式」候选由应用启动 / 设置按钮经 reg import 登记（ADR-0031）；
; 这里只在真卸载（非更新）时兜底清理，避免留下指向已卸载 exe 的菜单项与打开方式。

; 「文件打开方式」ProgId = 产品名去空格 + 「.」+ 类别（同 default-opener-windows 的 openWithProgId）
!searchreplace DEVCUBE_PROGID_PREFIX "${PRODUCT_NAME}" " " ""

; 对「文件打开方式」每个类别展开一次 MACRO（参数 ARG、类别名）；类别与 FILES_OPEN_WITH_EXTS 一致
!macro devcubeForEachOpenWithCategory MACRO ARG
  !insertmacro ${MACRO} "${ARG}" "image"
  !insertmacro ${MACRO} "${ARG}" "pdf"
  !insertmacro ${MACRO} "${ARG}" "pptx"
  !insertmacro ${MACRO} "${ARG}" "xlsx"
  !insertmacro ${MACRO} "${ARG}" "audio"
  !insertmacro ${MACRO} "${ARG}" "video"
  !insertmacro ${MACRO} "${ARG}" "text"
!macroend

!macro devcubeDeleteProgId UNUSED CATEGORY
  DeleteRegKey HKCU "Software\Classes\${DEVCUBE_PROGID_PREFIX}.${CATEGORY}"
!macroend

!macro devcubeDeleteOpenWithProgId EXT_KEY CATEGORY
  DeleteRegValue HKCU "Software\Classes\${EXT_KEY}\OpenWithProgids" "${DEVCUBE_PROGID_PREFIX}.${CATEGORY}"
!macroend

; v1.10–v1.15 的安装包用 electron-builder 的文件关联，把各扩展名的默认值（.ext 的默认）写成 Image / PDF 等通用 ProgId，
; 旧版卸载（更新时也会跑）只删 ProgId、不还原默认值，留下指向已删条目的残留，双击该类文件会报错。
; 默认值仍是这些名字、而该 ProgId 已不存在时删掉默认值；扩展名与名字是当年的快照，不随类别表变化。
!macro devcubeDropLegacyAssoc EXT CLASS
  ReadRegStr $0 HKCU "Software\Classes\.${EXT}" ""
  ${if} $0 == "${CLASS}"
    ClearErrors
    ReadRegStr $1 HKCU "Software\Classes\${CLASS}\shell\open\command" ""
    ${if} ${Errors}
      DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  !insertmacro devcubeDropLegacyAssoc "png" "Image"
  !insertmacro devcubeDropLegacyAssoc "jpg" "Image"
  !insertmacro devcubeDropLegacyAssoc "jpeg" "Image"
  !insertmacro devcubeDropLegacyAssoc "gif" "Image"
  !insertmacro devcubeDropLegacyAssoc "webp" "Image"
  !insertmacro devcubeDropLegacyAssoc "bmp" "Image"
  !insertmacro devcubeDropLegacyAssoc "ico" "Image"
  !insertmacro devcubeDropLegacyAssoc "svg" "Image"
  !insertmacro devcubeDropLegacyAssoc "pdf" "PDF"
  !insertmacro devcubeDropLegacyAssoc "pptx" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "ppsx" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "potx" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "pptm" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "ppsm" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "potm" "Presentation"
  !insertmacro devcubeDropLegacyAssoc "xlsx" "Spreadsheet"
  !insertmacro devcubeDropLegacyAssoc "xlsm" "Spreadsheet"
  !insertmacro devcubeDropLegacyAssoc "xltx" "Spreadsheet"
  !insertmacro devcubeDropLegacyAssoc "xltm" "Spreadsheet"
  !insertmacro devcubeDropLegacyAssoc "xls" "Spreadsheet"
  !insertmacro devcubeDropLegacyAssoc "mp3" "Audio"
  !insertmacro devcubeDropLegacyAssoc "m4a" "Audio"
  !insertmacro devcubeDropLegacyAssoc "aac" "Audio"
  !insertmacro devcubeDropLegacyAssoc "wav" "Audio"
  !insertmacro devcubeDropLegacyAssoc "flac" "Audio"
  !insertmacro devcubeDropLegacyAssoc "ogg" "Audio"
  !insertmacro devcubeDropLegacyAssoc "oga" "Audio"
  !insertmacro devcubeDropLegacyAssoc "mp4" "Video"
  !insertmacro devcubeDropLegacyAssoc "webm" "Video"
  !insertmacro devcubeDropLegacyAssoc "ogv" "Video"
!macroend

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
    ; 「文件打开方式」候选：各类 ProgId、Capabilities 与 RegisteredApplications，
    ; 再逐个扩展名键摘掉 OpenWithProgids 里挂的本应用 ProgId（遍历而非列表，旧版本多登记过的扩展名一并清掉）
    !insertmacro devcubeForEachOpenWithCategory devcubeDeleteProgId ""
    DeleteRegKey HKCU "Software\${PRODUCT_NAME}\Capabilities"
    DeleteRegKey /ifempty HKCU "Software\${PRODUCT_NAME}"
    DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCT_NAME}"
    StrCpy $1 0
    ${do}
      EnumRegKey $2 HKCU "Software\Classes" $1
      ${if} $2 == ""
        ${break}
      ${endIf}
      StrCpy $3 $2 1
      ${if} $3 == "."
        !insertmacro devcubeForEachOpenWithCategory devcubeDeleteOpenWithProgId "$2"
      ${endIf}
      IntOp $1 $1 + 1
    ${loop}
  ${endIf}
!macroend
