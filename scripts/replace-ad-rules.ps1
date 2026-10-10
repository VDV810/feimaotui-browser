# 用桌面导出的规则文件整体替换本机已标记广告规则
# 1) 备份旧规则到桌面 2) 写入新规则(序号接着最大号往下排, 不复用旧号)
# 3) 旧规则(不在新集合中的)写入墓碑, 防内置默认规则播种时复活
# 需先关闭飞毛腿浏览器(应用在内存里持有规则, 运行中改文件会被覆盖)
param(
    [string]$DataDir = "$env:APPDATA\feimaotui-browser\browser-data",
    [string]$Source  = "C:\Users\Administrator\Desktop\广告标记正常的.json",
    [string]$Backup  = "C:\Users\Administrator\Desktop\custom-ad-rules-备份-20261010.json"
)
$ErrorActionPreference = 'Stop'

$rulesFile = Join-Path $DataDir 'custom-ad-rules.json'
$tombFile  = Join-Path $DataDir 'custom-ad-rules-tombstones.json'

# 运行中检查
if (Get-Process feimaotui-browser -ErrorAction SilentlyContinue) {
    Write-Error "飞毛腿浏览器正在运行, 请先完全退出再执行(否则会被内存中的状态覆盖)"
    exit 1
}

# ---- 读旧规则 ----
# 注意: 必须用 -InputObject 取值, 否则 @(管道|ConvertFrom-Json) 会把整个数组套成单元素
$old = @()
if (Test-Path $rulesFile) {
    $rawOld = [System.IO.File]::ReadAllText($rulesFile, [System.Text.Encoding]::UTF8)
    $parsedOld = ConvertFrom-Json -InputObject $rawOld
    if ($null -ne $parsedOld) { $old = @($parsedOld) }
}
Write-Host "旧规则: $($old.Count) 条"
$maxSeq = 0
foreach ($r in $old) { if ($r.seq -and [int]$r.seq -gt $maxSeq) { $maxSeq = [int]$r.seq } }
Write-Host "旧规则最大序号: $maxSeq"

# ---- 备份 ----
if ($old.Count -gt 0) {
    [System.IO.File]::WriteAllText($Backup, ([System.IO.File]::ReadAllText($rulesFile, [System.Text.Encoding]::UTF8)), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "旧规则已备份 -> $Backup"
}

# ---- 读新规则 ----
$parsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8))
$list = if ($null -ne $parsed.rules) { @($parsed.rules) } else { @($parsed) }
Write-Host "新规则: $($list.Count) 条 (来源: $Source)"

# ---- 写入新规则(续号) ----
$out = New-Object System.Collections.ArrayList
$seq = $maxSeq
$newKeys = @{}
foreach ($item in $list) {
    $sel = ([string]$item.selector).Trim()
    if (-not $sel) { continue }
    $dom = ([string]$item.domain)
    if (-not $dom) { $dom = '*' }
    $dom = $dom.Split(':')[0]
    $seq++
    $newKeys["$sel|$dom"] = $true
    [void]$out.Add([ordered]@{
        selector   = $sel
        urlPattern = ''
        domain     = $dom
        createdAt  = if ($item.createdAt) { [long]$item.createdAt } else { [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
        seq        = $seq
    })
}
$json = ConvertTo-Json -InputObject $out -Depth 5
if ($out.Count -eq 1) { $json = "[$json]" }   # ConvertTo-Json 单元素会退化为对象
[System.IO.File]::WriteAllText($rulesFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "新规则已写入: $($out.Count) 条 (序号 $($maxSeq + 1) ~ $seq)"

# ---- 墓碑: 旧规则中不在新集合里的, 记墓碑防播种复活 ----
$tomb = @{}
if (Test-Path $tombFile) {
    $parsedTomb = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($tombFile, [System.Text.Encoding]::UTF8))
    if ($null -ne $parsedTomb) { foreach ($k in @($parsedTomb)) { if ($k) { $tomb[[string]$k] = $true } } }
}
$added = 0
foreach ($r in $old) {
    $key = ([string]$r.selector) + '|' + (([string]$r.domain).Split(':')[0])
    if (-not $newKeys.ContainsKey($key) -and -not $tomb.ContainsKey($key)) { $tomb[$key] = $true; $added++ }
}
$tombArr = @($tomb.Keys)
[System.IO.File]::WriteAllText($tombFile, (ConvertTo-Json -InputObject $tombArr -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "墓碑: 新增 $added 条, 合计 $($tombArr.Count) 条"

# ---- 结果核对 ----
$checkParsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($rulesFile, [System.Text.Encoding]::UTF8))
$check = @($checkParsed)
$firstSeq = $check[0].seq
$lastSeq = $check[$check.Count - 1].seq
Write-Host "核对: 当前规则 $($check.Count) 条, 序号 $firstSeq ~ $lastSeq"
Write-Host "完成"
