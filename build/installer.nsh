!include "FileFunc.nsh"
!include "LogicLib.nsh"

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