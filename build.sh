#!/bin/bash

# 超级浏览器 - 跨平台打包脚本

echo "=========================================="
echo "   超级浏览器 - 打包脚本"
echo "=========================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js，请先安装 Node.js"
    exit 1
fi

echo "[1/5] 检查 Node.js 版本..."
node -v
echo ""

# 安装依赖
echo "[2/5] 安装项目依赖..."
npm install
echo ""

# 安装 Electron（如果未安装）
echo "[3/5] 检查 Electron..."
if [ ! -d "node_modules/electron" ]; then
    echo "正在安装 Electron..."
    npm install electron --save-dev
fi
echo ""

# 安装 electron-builder
echo "[4/5] 检查 electron-builder..."
if [ ! -d "node_modules/electron-builder" ]; then
    echo "正在安装 electron-builder..."
    npm install electron-builder --save-dev
fi
echo ""

# 检查图标文件
echo "[5/5] 检查图标文件..."
if [ ! -f "assets/icon.ico" ]; then
    echo "[警告] 未找到 assets/icon.ico，将使用默认图标"
    echo "你可以使用在线工具将 PNG 转换为 ICO 格式"
fi
echo ""

echo "=========================================="
echo "   开始打包..."
echo "=========================================="
echo ""

# 检测操作系统
OS="$(uname -s)"
case "$OS" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=mac;;
    CYGWIN*)    PLATFORM=win;;
    MINGW*)     PLATFORM=win;;
    MSYS*)      PLATFORM=win;;
    *)          PLATFORM=unknown;;
esac

echo "检测到平台: $PLATFORM"
echo ""

# 执行打包
case "$PLATFORM" in
    win)
        npm run build:win
        ;;
    mac)
        npm run build:mac
        ;;
    linux)
        npm run build:linux
        ;;
    *)
        echo "[错误] 不支持的平台: $OS"
        exit 1
        ;;
esac

if [ $? -ne 0 ]; then
    echo ""
    echo "[错误] 打包失败！"
    exit 1
fi

echo ""
echo "=========================================="
echo "   打包完成！"
echo "=========================================="
echo ""
echo "安装包位置: dist/"
echo ""
