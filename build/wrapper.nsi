!define OUTFILE "/workspace/electron-browser/release/Feimaotui-Browser-Setup-1.3.10.exe"
OutFile "${OUTFILE}"
VIProductVersion "1.3.10.0"
VIAddVersionKey /LANG=1033 ProductName "飞毛腿浏览器"
VIAddVersionKey /LANG=1033 ProductVersion "1.3.10"
VIAddVersionKey /LANG=1033 LegalCopyright "Copyright © 2026"
VIAddVersionKey /LANG=1033 FileDescription "飞毛腿浏览器"
VIAddVersionKey /LANG=1033 FileVersion "1.3.10"
VIAddVersionKey /LANG=1033 CompanyName "Electron Browser Team"
SetCompressor zlib
Unicode true
!addincludedir "/workspace/electron-browser/node_modules/app-builder-lib/templates/nsis"
!include "installer.nsi"