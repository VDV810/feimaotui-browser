# 替换应用内置默认广告规则(assets/default-ad-rules.json)
# 用途: 新用户安装后自动获得这套标记, 序号从 1 开始
param(
    [string]$Source = "C:\Users\Administrator\Desktop\广告标记正常的.json",
    [string]$Target = "C:\Users\Administrator\WorkBuddy\2026-08-27-11-42-38\feimaotui-browser\assets\default-ad-rules.json",
    [string]$Backup = "C:\Users\Administrator\Desktop\default-ad-rules-旧27条-备份-20261010.json"
)
$ErrorActionPreference = 'Stop'

# 备份旧的内置规则(放到仓库外, 不会被打进安装包)
if (Test-Path $Target) {
    Copy-Item $Target $Backup -Force
    $oldCount = @((ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Target, [System.Text.Encoding]::UTF8))).rules).Count
    Write-Host "旧内置规则已备份 -> $Backup ($oldCount 条)"
}

# 读来源规则
$src = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8))
$list = if ($null -ne $src.rules) { @($src.rules) } else { @($src) }

# 规范化为内置文件格式(与导出格式一致), 去重
$seen = @{}
$rules = New-Object System.Collections.ArrayList
foreach ($item in $list) {
    $sel = ([string]$item.selector).Trim()
    if (-not $sel) { continue }
    $dom = ([string]$item.domain); if (-not $dom) { $dom = '*' }; $dom = $dom.Split(':')[0]
    $key = "$sel|$dom"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    [void]$rules.Add([ordered]@{
        selector  = $sel
        domain    = $dom
        createdAt = if ($item.createdAt) { [long]$item.createdAt } else { [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
    })
}

$payload = [ordered]@{
    appName    = '飞毛腿浏览器'
    type       = 'ad-rules'
    exportTime = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    rules      = $rules
}
$json = ConvertTo-Json -InputObject $payload -Depth 6
[System.IO.File]::WriteAllText($Target, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "新内置规则已写入: $($rules.Count) 条 -> $Target"

# 回读校验
$chk = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Target, [System.Text.Encoding]::UTF8))
Write-Host "回读校验: $(@($chk.rules).Count) 条, 首条域名=$($chk.rules[0].domain)"
Write-Host "完成 (新用户安装后按 #1 ~ #$($rules.Count) 编号)"
