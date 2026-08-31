!include "FileFunc.nsh"
!include "LogicLib.nsh"

; 中文化欢迎、完成与卸载页面的说明文字。
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 OrbitSSH"
!define MUI_WELCOMEPAGE_TEXT "本向导将引导您完成 OrbitSSH 的安装。$\r$\n$\r$\nOrbitSSH 是面向高效连接与管理的 SSH 客户端。"
!define MUI_FINISHPAGE_TITLE "OrbitSSH 安装完成"
!define MUI_FINISHPAGE_TEXT "OrbitSSH 已成功安装到您的设备。单击“完成”即可立即启动应用。"
!define MUI_UNWELCOMEPAGE_TITLE "卸载 OrbitSSH"
!define MUI_UNWELCOMEPAGE_TEXT "本向导将从您的设备中移除 OrbitSSH。"
!define MUI_UNFINISHPAGE_TITLE "OrbitSSH 已卸载"
!define MUI_UNFINISHPAGE_TEXT "OrbitSSH 已从您的设备中移除。您的应用数据将根据当前设置予以保留。"

!macro customHeader
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE fnAppendProductName
!macroend

Function fnAppendProductName
  ${GetFileName} "$INSTDIR" $0

  ${If} $0 != "OrbitSSH"
    StrCpy $INSTDIR "$INSTDIR\OrbitSSH"
  ${EndIf}
FunctionEnd

!macro customInstall
!macroend

!macro customUnInstall
!macroend
