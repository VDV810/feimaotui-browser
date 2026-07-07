@echo off
chcp 65001 >nul
echo 正在启动飞毛腿浏览器 1.1.58...
cd /d "%~dp0release\win-unpacked"
start "" "飞毛腿浏览器.exe"
exit
