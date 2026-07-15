; 飞毛腿浏览器 NSIS 安装脚本
; MUI2 现代界面 + Unicode + 简体中文
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

; Unicode 支持（必须在最前面）
Unicode True

; ==================== 基本设置 ====================
!define PRODUCT_NAME "飞毛腿浏览器"
!define PRODUCT_VERSION "1.2.27"
!define PRODUCT_PUBLISHER "飞毛腿浏览器团队"
!define PRODUCT_EXE "飞毛腿浏览器.exe"
!define PRODUCT_REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

; 输出文件
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "Feimaotui-Browser-Setup-${PRODUCT_VERSION}.exe"

; 安装目录
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKLM "${PRODUCT_REGKEY}" "InstallLocation"

; 请求管理员权限
RequestExecutionLevel admin

; 压缩设置
SetCompressor /SOLID lzma
SetCompressorDictSize 64

; ==================== MUI2 现代界面设置 ====================
!define MUI_ABORTWARNING
!define MUI_ICON "build\icon.ico"
!define MUI_UNICON "build\icon.ico"

; ==================== 安装页面 ====================
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; ==================== 卸载页面 ====================
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; ==================== 语言 - 简体中文 ====================
!insertmacro MUI_LANGUAGE "SimpChinese"

; 自定义语言字符串
LangString DESC_SecMain ${LANG_SIMPCHINESE} "安装飞毛腿浏览器主程序"

; ==================== 版本信息 ====================
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} 安装程序"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 ${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"

; ==================== 初始化函数 ====================
Function .onInit
  ; 检查是否已安装旧版本
  ReadRegStr $R0 HKLM "${PRODUCT_REGKEY}" "UninstallString"
  ${If} $R0 != ""
    ; 已安装，先卸载旧版本
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到已安装旧版本 ${PRODUCT_NAME}，即将先卸载旧版本再继续安装。" IDOK +2
    Abort
    
    ; 执行卸载
    ExecWait '"$R0" /S'
    
    ; 等待卸载完成
    Sleep 2000
  ${EndIf}
FunctionEnd

; ==================== 安装节 ====================
Section "主程序" SecMain
  SectionIn RO

  ; 强制终止旧版本进程
  DetailPrint "正在关闭旧版本浏览器..."
  nsExec::ExecToLog 'taskkill /F /IM "飞毛腿浏览器.exe"'
  Sleep 2000

  ; 彻底删除旧安装目录，确保新文件完整覆盖
  DetailPrint "正在清理旧版本文件..."
  RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"

  ; 复制所有文件
  File /r "release\win-unpacked\*"

  ; 创建开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0

  ; 创建桌面快捷方式
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}" "" "$INSTDIR\icon.ico" 0

  ; 写入注册表 - 卸载信息
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${PRODUCT_REGKEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegDWORD HKLM "${PRODUCT_REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${PRODUCT_REGKEY}" "NoRepair" 1

  ; 计算安装大小
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${PRODUCT_REGKEY}" "EstimatedSize" "$0"

  ; 创建卸载程序
  WriteUninstaller "$INSTDIR\uninstall.exe"

SectionEnd

; ==================== 卸载节 ====================
Section "Uninstall"
  ; 终止运行中的浏览器进程
  nsExec::ExecToLog 'taskkill /F /IM "飞毛腿浏览器.exe"'

  ; 等待进程结束
  Sleep 1000

  ; 删除文件
  RMDir /r "$INSTDIR"

  ; 删除开始菜单快捷方式
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\卸载 ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; 删除桌面快捷方式
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; 删除注册表
  DeleteRegKey HKLM "${PRODUCT_REGKEY}"

SectionEnd

; ==================== 安装节描述 ====================
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_SecMain)
!insertmacro MUI_FUNCTION_DESCRIPTION_END
