/**
 * NSIS 自定义安装脚本
 *
 * 功能：目录选择页自动补全产品名
 * 示例：用户选择 D:\ → 自动变为 D:\OrbitSSH
 *       用户选择 D:\Tools → 自动变为 D:\Tools\OrbitSSH
 *       如果末尾已经是 OrbitSSH 则不再重复追加
 */

!macro preInit
  ; 必须在 MUI_PAGE_DIRECTORY 插入之前定义 leave 回调
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE fnAppendProductName
!macroend

Function fnAppendProductName
  ; 取出当前路径的最后一层目录名
  ${GetFileName} $INSTDIR $0

  ; 如果不是 OrbitSSH，自动补上
  ${If} $0 != "OrbitSSH"
    StrCpy $INSTDIR "$INSTDIR\OrbitSSH"
  ${EndIf}
FunctionEnd

!macro customInstall
!macroend

!macro customUnInstall
!macroend
