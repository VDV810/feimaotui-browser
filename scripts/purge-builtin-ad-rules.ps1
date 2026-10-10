# 把内置默认规则中"不在当前用户规则集合里"的全部登记进墓碑, 防止下次启动自动播种回来
# (墓碑只影响 seedDefaultAdRules 播种, 不影响当前规则本身)
param(
    [string]$DataDir = "$env:APPDATA\feimaotui-browser\browser-data",
    [string]$Builtin = "C:\Users\Administrator\WorkBuddy\2026-08-27-11-42-38\feimaotui-browser\assets\default-ad-rules.json"
)
$ErrorActionPreference = 'Stop'
if (Get-Process feimaotui-browser -ErrorAction SilentlyContinue) {
    Write-Error "飞毛腿浏览器正在运行, 请先完全退出再执行"; exit 1
}

$rulesFile = Join-Path $DataDir 'custom-ad-rules.json'
$tombFile  = Join-Path $DataDir 'custom-ad-rules-tombstones.json'

# 当前规则键集合
$cur = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($rulesFile, [System.Text.Encoding]::UTF8))
$curKeys = @{}
foreach ($r in @($cur)) { $curKeys[(([string]$r.selector).Trim() + '|' + (([string]$r.domain).Split(':')[0]))] = $true }
Write-Host "当前规则: $($curKeys.Count) 条"

# 已有墓碑
$tomb = @{}
if (Test-Path $tombFile) {
    $t = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($tombFile, [System.Text.Encoding]::UTF8))
    if ($null -ne $t) { foreach ($k in @($t)) { if ($k) { $tomb[[string]$k] = $true } } }
}
$before = $tomb.Count

# 内置规则中不在当前集合里的 → 记墓碑
$b = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Builtin, [System.Text.Encoding]::UTF8))
$blist = if ($null -ne $b.rules) { @($b.rules) } else { @($b) }
$added = 0
foreach ($item in $blist) {
    $sel = ([string]$item.selector).Trim()
    if (-not $sel) { continue }
    $dom = ([string]$item.domain); if (-not $dom) { $dom = '*' }; $dom = $dom.Split(':')[0]
    $key = "$sel|$dom"
    if ($curKeys.ContainsKey($key)) { continue }     # 桌面上有的, 保留
    if ($tomb.ContainsKey($key)) { continue }        # 已墓碑
    $tomb[$key] = $true; $added++
}
[System.IO.File]::WriteAllText($tombFile, (ConvertTo-Json -InputObject @($tomb.Keys) -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "内置规则共 $($blist.Count) 条; 本次新增墓碑 $added 条 (墓碑总数 $before -> $($tomb.Count))"
Write-Host "完成: 下次启动不会再播种被删除的内置标记"
