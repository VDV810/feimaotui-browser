#!/bin/bash
# Build script for 飞毛腿浏览器
# Uses staged build: dir -> Python icon set -> NSIS
# This avoids wine/rcedit issues on Linux

set -e
cd "$(dirname "$0")"

echo "=== Step 1: Clean and build unpacked directory ==="
rm -rf release
npx electron-builder --win --x64 --dir

echo "=== Step 2: Set icon using Python script ==="
EXE_PATH="release/win-unpacked/飞毛腿浏览器.exe"
ICON_PATH="build/icon4.ico"

if [ ! -f "$EXE_PATH" ]; then
    echo "ERROR: EXE not found at $EXE_PATH"
    exit 1
fi

python3 build/set_icon.py "$EXE_PATH" "$ICON_PATH"

echo "=== Step 3: Build NSIS installer from prepackaged directory ==="
npx electron-builder --win nsis --x64 --prepackaged release/win-unpacked || true

echo "=== Build complete ==="
ls -la release/*.exe 2>/dev/null || echo "No installer found!"
