[CmdletBinding()]
param()

# PostToolUse hook (matched on Edit|Write): after every edit, re-reads the
# host project's PROGRESS.md, diffs its milestone statuses against the last
# snapshot, and logs a "milestone_shipped" telemetry event for anything that
# just flipped to done. Pairs with continue-loop.ps1's "milestone_started"
# event (matched by the same display-name format) so devkit-stats can report
# a duration per milestone. Never blocks anything - always exits 0.

[Console]::In.ReadToEnd() | Out-Null

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir -or -not (Test-Path -LiteralPath $projectDir)) {
    exit 0
}

$progressPath = Join-Path $projectDir 'PROGRESS.md'
if (-not (Test-Path -LiteralPath $progressPath)) {
    exit 0
}

# Build a status map for every milestone/task line found, keyed so the same
# item is recognised run to run:
#   table row " | 13 | Blocks | ✅ | " -> key "M13", display "M13 - Blocks"
#   checklist "- [x] Some task"        -> key "Some task", display "Some task"
$current = @{}
foreach ($line in Get-Content -LiteralPath $progressPath) {
    if ($line -match '^\s*\|\s*([\w.]+)\s*\|\s*(.+?)\s*\|\s*(⬜|⏳|🟨|⏸|✅)\s*(\||$)') {
        $key = "M$($Matches[1])"
        $current[$key] = [PSCustomObject]@{
            display = "M$($Matches[1]) - $($Matches[2].Trim())"
            done    = ($Matches[3] -eq '✅')
        }
        continue
    }
    if ($line -match '^\s*-\s*\[( |x|X)\]\s*(.+)$') {
        $text = $Matches[2].Trim()
        $current[$text] = [PSCustomObject]@{
            display = $text
            done    = ($Matches[1] -ne ' ')
        }
    }
}

if ($current.Count -eq 0) {
    exit 0
}

$projectHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($projectDir))
) -replace '-', ''
$telemetryDir = Join-Path $env:LOCALAPPDATA 'rajesh-devkit\telemetry'
New-Item -ItemType Directory -Force -Path $telemetryDir | Out-Null
$snapshotPath = Join-Path $telemetryDir "$projectHash.snapshot.json"
$telemetryPath = Join-Path $telemetryDir "$projectHash.jsonl"

$previous = @{}
if (Test-Path -LiteralPath $snapshotPath) {
    try {
        $raw = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
        foreach ($prop in $raw.PSObject.Properties) { $previous[$prop.Name] = [bool]$prop.Value }
    } catch { $previous = @{} }
}

$nowUtc = (Get-Date).ToUniversalTime().ToString('o')
foreach ($key in $current.Keys) {
    $wasDone = $false
    if ($previous.ContainsKey($key)) { $wasDone = $previous[$key] }
    if ($current[$key].done -and -not $wasDone) {
        @{
            event     = 'milestone_shipped'
            milestone = $current[$key].display
            timestamp = $nowUtc
        } | ConvertTo-Json -Compress | Add-Content -LiteralPath $telemetryPath -Encoding utf8
    }
}

$snapshot = @{}
foreach ($key in $current.Keys) { $snapshot[$key] = $current[$key].done }
$snapshot | ConvertTo-Json -Compress | Set-Content -LiteralPath $snapshotPath -Encoding utf8

exit 0
