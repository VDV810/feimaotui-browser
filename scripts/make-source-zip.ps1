# 打包源码 zip: 除产物目录(release)外全部打包(含 node_modules/.git/extensions)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\make-source-zip.ps1
param(
    [string]$Root = "C:\Users\Administrator\WorkBuddy\2026-08-27-11-42-38\feimaotui-browser",
    [string]$Out  = "C:\Users\Administrator\Desktop\feimaotui-browser-完整源码-v2.20.0-20261009.zip"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 排除的顶层目录(产物)
$excludeDirs = @('release', 'release2', 'release3', 'release4', 'release5', 'dist', 'out', 'win-unpacked')

if (Test-Path $Out) { Remove-Item $Out -Force }
$rootFull = (Resolve-Path $Root).Path.TrimEnd('\')

$files = Get-ChildItem -Path $rootFull -Recurse -File -Force | Where-Object {
    $rel = $_.FullName.Substring($rootFull.Length + 1)
    $top = $rel.Split('\')[0]
    ($excludeDirs -notcontains $top) -and ($rel -ne $Out)
}

Write-Host "文件数: $($files.Count)"
$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("待压缩: {0:N1} MB" -f ($total / 1MB))

$zip = [System.IO.Compression.ZipFile]::Open($Out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $i = 0
    foreach ($f in $files) {
        # zip 规范要求正斜杠分隔; 直接用 Windows 相对路径会写入反斜杠(非标准, 部分解压工具异常)
        $rel = $f.FullName.Substring($rootFull.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $i++
        if ($i % 2000 -eq 0) { Write-Host "  已加入 $i / $($files.Count)" }
    }
} finally {
    $zip.Dispose()
}
$size = (Get-Item $Out).Length
Write-Host ("完成: {0} ({1:N1} MB)" -f $Out, ($size / 1MB))
