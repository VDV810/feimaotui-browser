@echo off
chcp 65001
cls
echo ==========================================
echo    超级浏览器 - Windows 打包脚本
echo ==========================================
echo.

REM 检查 Node.js
node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo [1/5] 检查 Node.js 版本...
node -v
echo.

REM 安装依赖
echo [2/5] 安装项目依赖...
call npm install
echo.

REM 安装 Electron（如果未安装）
echo [3/5] 检查 Electron...
if not exist "node_modules\electron" (
    echo 正在安装 Electron...
    call npm install electron --save-dev
)
echo.

REM 安装 electron-builder
echo [4/5] 检查 electron-builder...
if not exist "node_modules\electron-builder" (
    echo 正在安装 electron-builder...
    call npm install electron-builder --save-dev
)
echo.

REM 检查图标文件
echo [5/5] 检查图标文件...
if not exist "assets\icon.ico" (
    echo [警告] 未找到 assets\icon.ico，将使用默认图标
    echo 你可以使用在线工具将 PNG 转换为 ICO 格式
)
echo.

echo ==========================================
echo    开始打包...
echo ==========================================
echo.

REM 执行打包
call npm run build:win

if errorlevel 1 (
    echo.
    echo [错误] 打包失败！
    pause
    exit /b 1
)

echo.
echo ==========================================
echo    打包完成！
echo ==========================================
echo.
echo 安装包位置: dist\超级浏览器 Setup.exe
echo 便携版位置: dist\超级浏览器.exe
echo.
pause
