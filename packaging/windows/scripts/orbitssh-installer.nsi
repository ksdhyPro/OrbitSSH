; OrbitSSH Windows 自绘安装器。
; 由 OrbitSSHSkin 渲染 XML 页面，安装逻辑独立于 electron-builder 默认 NSIS 模板。

RequestExecutionLevel user

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"
!include "nsProcess.nsh"

!ifndef APP_ARCHIVE
  !error "缺少 APP_ARCHIVE 编译参数"
!endif
!ifndef SKIN_ARCHIVE
  !error "缺少 SKIN_ARCHIVE 编译参数"
!endif
!ifndef LICENSE_FILE
  !error "缺少 LICENSE_FILE 编译参数"
!endif

!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "OrbitSSH"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.0.0"
!endif
!ifndef EXE_NAME
  !define EXE_NAME "OrbitSSH.exe"
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "OrbitSSH-Setup.exe"
!endif
!ifndef INSTALLER_ICON
  !define INSTALLER_ICON "..\assets\orbitssh.ico"
!endif

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
Icon "${INSTALLER_ICON}"
UninstallIcon "${INSTALLER_ICON}"

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} 安装程序"

Page custom ShowInstallPage
UninstPage custom un.ShowUninstallPage

; 普通交互安装由 XML 页面中的“开始安装”按钮触发，保留空段以满足 NSIS 结构要求。
Section "OrbitSSH"
SectionEnd

Section "un.OrbitSSH"
SectionEnd

Var hInstallDialog
Var installInProgress
Var installCompleted
Var updateMode
Var forceRun
Var installRoot

!define PAGE_CONFIG 0
!define PAGE_INSTALLING 1
!define PAGE_FINISH 2
!define PAGE_UNINSTALL 3
!define PAGE_UNINSTALLING 4
!define PAGE_UNINSTALL_FINISH 5

Function .onInit
  ; 优先使用旧安装位置，确保覆盖升级不会新建第二个目录。
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR "$0"
  ${EndIf}

  ${GetParameters} $0
  ${GetOptions} "$0" "/D=" $1
  ${IfNot} ${Errors}
    StrCpy $INSTDIR "$1"
  ${EndIf}
  ${GetOptions} "$0" "--updated" $1
  ${IfNot} ${Errors}
    StrCpy $updateMode "1"
  ${EndIf}
  ${GetOptions} "$0" "--force-run" $1
  ${IfNot} ${Errors}
    StrCpy $forceRun "1"
  ${EndIf}

  ${If} ${Silent}
    Call InstallApplication
    ${If} $forceRun == "1"
      Exec '"$INSTDIR\${EXE_NAME}" --updated'
    ${EndIf}
    Quit
  ${EndIf}
FunctionEnd

Function ShowInstallPage
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=skin.zip "${SKIN_ARCHIVE}"
  File /oname=license.txt "${LICENSE_FILE}"
  File /oname=orbitssh.ico "${INSTALLER_ICON}"

  ; 开启 150% 与 200% DPI 资源适配，更高缩放比例按 200% 资源显示。
  OrbitSSHSkin::EnableDpi 1 1 0 0
  OrbitSSHSkin::InitSkinPage "$PLUGINSDIR\" "license.txt"
  Pop $hInstallDialog
  ${If} $hInstallDialog == error
    MessageBox MB_ICONSTOP "无法加载 OrbitSSH 安装器界面。"
    Abort
  ${EndIf}

  Call NormalizeInstallPath
  OrbitSSHSkin::SetWindowTile $hInstallDialog "OrbitSSH 安装程序"
  OrbitSSHSkin::SetWindowSize $hInstallDialog 480 390
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "editDir" "text" "$INSTDIR"
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "licensename" "text" "OrbitSSH 许可与服务协议"
  OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_CONFIG}

  GetFunctionAddress $0 OnBrowseDirectory
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnSelectDir" $0
  GetFunctionAddress $0 OnInstall
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnInstall" $0
  GetFunctionAddress $0 OnShowLicense
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnAgreement" $0
  GetFunctionAddress $0 OnCloseLicense
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnAgree" $0
  GetFunctionAddress $0 OnFinish
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnRun" $0
  GetFunctionAddress $0 OnShowMore
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnShowMore" $0
  GetFunctionAddress $0 OnHideMore
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnHideMore" $0
  GetFunctionAddress $0 OnMinimize
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnFinishedMin" $0
  GetFunctionAddress $0 OnExitInstaller
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnClose" $0
  OrbitSSHSkin::BindCallBack $hInstallDialog "syscommandclose" $0
  OrbitSSHSkin::ShowPage 0
FunctionEnd

; 统一保证用户选择的目录以 OrbitSSH 作为最终子目录。
Function NormalizeInstallPath
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "${PRODUCT_NAME}"
    StrCpy $INSTDIR "$INSTDIR\${PRODUCT_NAME}"
  ${EndIf}
FunctionEnd

Function OnBrowseDirectory
  OrbitSSHSkin::SelectInstallDirEx $hInstallDialog "选择 OrbitSSH 的安装位置"
  Pop $0
  ${If} $0 != ""
    StrCpy $INSTDIR "$0"
    Call NormalizeInstallPath
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "editDir" "text" "$INSTDIR"
  ${EndIf}
FunctionEnd

Function OnShowLicense
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "licenseshow" "visible" "true"
  ; 展开高级设置时同步扩展协议面板，保持 temp 模板的显示范围。
  OrbitSSHSkin::GetControlAttribute $hInstallDialog "moreconfiginfo" "visible"
  Pop $0
  ${If} $0 == "1"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "licenseshow" "pos" "5,35,475,495"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "editLicense" "height" "375"
  ${Else}
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "licenseshow" "pos" "5,35,475,385"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "editLicense" "height" "270"
  ${EndIf}
FunctionEnd

Function OnCloseLicense
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "licenseshow" "visible" "false"
FunctionEnd

; 完全复用 temp 模板的安装路径展开与收起方式。
Function OnShowMore
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "moreconfiginfo" "visible" "true"
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "btnHideMore" "visible" "true"
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "btnShowMore" "visible" "false"
  OrbitSSHSkin::SetWindowSize $hInstallDialog 480 500
FunctionEnd

Function OnHideMore
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "moreconfiginfo" "visible" "false"
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "btnHideMore" "visible" "false"
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "btnShowMore" "visible" "true"
  OrbitSSHSkin::SetWindowSize $hInstallDialog 480 390
FunctionEnd

Function OnMinimize
  SendMessage $hInstallDialog ${WM_SYSCOMMAND} 0xF020 0
FunctionEnd

Function OnInstall
  OrbitSSHSkin::GetControlAttribute $hInstallDialog "chkAgree" "selected"
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_ICONEXCLAMATION "请先阅读并同意许可与服务协议。"
    Return
  ${EndIf}
  OrbitSSHSkin::GetControlAttribute $hInstallDialog "editDir" "text"
  Pop $INSTDIR
  Call NormalizeInstallPath
  OrbitSSHSkin::SetControlAttribute $hInstallDialog "editDir" "text" "$INSTDIR"

  nsProcess::_FindProcess "${EXE_NAME}"
  Pop $0
  ${If} $0 == 0
    MessageBox MB_ICONEXCLAMATION "OrbitSSH 正在运行，请先退出应用后再安装。"
    Return
  ${EndIf}

  OrbitSSHSkin::SetWindowSize $hInstallDialog 480 390
  Call InstallApplication
  ${If} $installCompleted == "1"
    OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_FINISH}
  ${EndIf}
FunctionEnd

Function InstallApplication
  ${If} $installInProgress == "1"
    Return
  ${EndIf}
  StrCpy $installInProgress "1"
  Call NormalizeInstallPath

  ${If} $hInstallDialog != ""
    OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_INSTALLING}
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "min" "0"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "max" "100"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "value" "5"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_pos" "text" "5%"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_tip" "text" "正在准备安装"
  ${EndIf}

  CreateDirectory "$INSTDIR"
  ; 交互安装在后台解压应用包，让窗口消息循环持续刷新真实进度。
  ${If} $hInstallDialog != ""
    GetFunctionAddress $0 ExtractApplicationFiles
    BgWorker::CallAndWait
  ${Else}
    Call ExtractApplicationFiles
  ${EndIf}

  ${IfNot} ${FileExists} "$INSTDIR\${EXE_NAME}"
    StrCpy $installInProgress "0"
    SetErrorLevel 1
    ${If} $hInstallDialog != ""
      MessageBox MB_ICONSTOP "应用文件解压失败，请重新下载安装包后重试。"
    ${EndIf}
    Return
  ${EndIf}

  ${If} $hInstallDialog != ""
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "value" "92"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_pos" "text" "92%"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_tip" "text" "正在创建快捷方式"
  ${EndIf}

  ; temp 模板没有快捷方式开关，沿用原界面的默认勾选行为。
  StrCpy $0 "1"
  ${If} $0 == "1"
    SetShellVarContext current
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
  ${EndIf}
  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe"

  WriteUninstaller "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" '"$INSTDIR\Uninstall ${PRODUCT_NAME}.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1

  StrCpy $installCompleted "1"
  StrCpy $installInProgress "0"
  ${If} $hInstallDialog != ""
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "value" "100"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_pos" "text" "100%"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_tip" "text" "安装完成"
  ${EndIf}
FunctionEnd

; 将预压缩的应用文件释放到安装目录，并通过 7z 回调上报实际解压字节数。
Function ExtractApplicationFiles
  SetOutPath "$INSTDIR"
  File /oname=orbitssh-app.7z "${APP_ARCHIVE}"
  GetFunctionAddress $R9 ExtractCallback
  nsis7zU::ExtractWithCallback "$INSTDIR\orbitssh-app.7z" $R9
  Delete "$INSTDIR\orbitssh-app.7z"
FunctionEnd

Function ExtractCallback
  Pop $1
  Pop $2
  ${If} $2 == 0
    Return
  ${EndIf}

  ; 应用解压占整体进度的 5% 到 90%，剩余进度用于快捷方式和注册信息。
  System::Int64Op $1 * 85
  Pop $3
  System::Int64Op $3 / $2
  Pop $0
  IntOp $0 $0 + 5
  ${If} $hInstallDialog != ""
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrProgress" "value" "$0"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_pos" "text" "$0%"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "progress_tip" "text" "正在解压应用文件"
  ${EndIf}
FunctionEnd

Function OnFinish
  Exec '"$INSTDIR\${EXE_NAME}"'
  Call OnExitInstaller
FunctionEnd

Function OnExitInstaller
  ${If} $installInProgress == "1"
    MessageBox MB_ICONEXCLAMATION "安装正在进行，请稍候。"
    Return
  ${EndIf}
  OrbitSSHSkin::ExitDUISetup
FunctionEnd

Function un.ShowUninstallPage
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=skin.zip "${SKIN_ARCHIVE}"
  File /oname=orbitssh.ico "${INSTALLER_ICON}"
  ; 卸载界面与安装界面使用相同的高 DPI 策略。
  OrbitSSHSkin::EnableDpi 1 1 0 0
  OrbitSSHSkin::InitSkinPage "$PLUGINSDIR\" ""
  Pop $hInstallDialog
  ${If} $hInstallDialog == error
    MessageBox MB_ICONSTOP "无法加载 OrbitSSH 卸载界面。"
    Abort
  ${EndIf}

  OrbitSSHSkin::SetWindowTile $hInstallDialog "OrbitSSH 卸载程序"
  OrbitSSHSkin::SetWindowSize $hInstallDialog 480 390
  OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_UNINSTALL}
  GetFunctionAddress $0 un.OnUninstall
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnUnInstall" $0
  GetFunctionAddress $0 un.OnExit
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnClose" $0
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnUninstalled" $0
  OrbitSSHSkin::BindCallBack $hInstallDialog "syscommandclose" $0
  GetFunctionAddress $0 un.OnMinimize
  OrbitSSHSkin::BindCallBack $hInstallDialog "btnFinishedMin" $0
  OrbitSSHSkin::ShowPage 0
FunctionEnd

Function un.onInit
  ${If} ${Silent}
    Call un.RemoveApplication
    Quit
  ${EndIf}
FunctionEnd

Function un.OnUninstall
  nsProcess::_FindProcess "${EXE_NAME}"
  Pop $0
  ${If} $0 == 0
    MessageBox MB_ICONEXCLAMATION "OrbitSSH 正在运行，请先退出应用后再卸载。"
    Return
  ${EndIf}
  Call un.RemoveApplication
  OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_UNINSTALL_FINISH}
FunctionEnd

Function un.RemoveApplication
  ${If} $hInstallDialog != ""
    OrbitSSHSkin::ShowPageItem $hInstallDialog "wizardTab" ${PAGE_UNINSTALLING}
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrUnInstProgress" "value" "20"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "un_progress_pos" "text" "20%"
  ${EndIf}

  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

  ${If} $hInstallDialog != ""
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrUnInstProgress" "value" "60"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "un_progress_pos" "text" "60%"
  ${EndIf}
  ; temp 模板使用“保留我的数据”语义，取消勾选后才删除本地数据。
  StrCpy $0 "1"
  ${If} $hInstallDialog != ""
    OrbitSSHSkin::GetControlAttribute $hInstallDialog "chkbox_userdata" "selected"
    Pop $0
  ${EndIf}
  ${If} $0 == "0"
    RMDir /r "$APPDATA\orbitssh"
  ${EndIf}

  ; 只删除安装目录，不触碰其他用户目录。
  RMDir /r "$INSTDIR"
  ${If} $hInstallDialog != ""
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "slrUnInstProgress" "value" "100"
    OrbitSSHSkin::SetControlAttribute $hInstallDialog "un_progress_pos" "text" "100%"
  ${EndIf}
FunctionEnd

Function un.OnMinimize
  SendMessage $hInstallDialog ${WM_SYSCOMMAND} 0xF020 0
FunctionEnd

Function un.OnExit
  OrbitSSHSkin::ExitDUISetup
FunctionEnd
