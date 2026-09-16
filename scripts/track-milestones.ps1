[CmdletBinding()]
param()

# PostToolUse hook (matched on Edit|Write): after every edit, re-reads the
# host project's PROGRESS.md, diffs its milestone statuses against the last
# snapshot, and logs a "milestone_shipped" telemetry event for anything that
# just flipped to done. Pairs with continue-loop.ps1's "milestone_started"
# event (matched by the same display-name format) so devkit-stats can report
# a duration per milestone. Never blocks anything - always exits 0.

# Windows PowerShell 5.1's -Encoding utf8 always writes a BOM, which breaks a
# strict line-by-line JSON parser on the very first line of the telemetry
# log. Write without one explicitly instead.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Ensure-GitignoreEntry {
    param($ProjectDir, $Entry)

    $gitignorePath = Join-Path $ProjectDir '.gitignore'
    $existingText = ''
    if (Test-Path -LiteralPath $gitignorePath) {
        $existingText = Get-Content -LiteralPath $gitignorePath -Raw -ErrorAction SilentlyContinue
        if ($null -eq $existingText) { $existingText = '' }
    }
    if (($existingText -split "`r?`n") -contains $Entry) { return }

    $prefix = ''
    if ($existingText.Length -gt 0 -and -not $existingText.EndsWith("`n")) { $prefix = "`n" }
    $block = "$prefix`n# rajesh-devkit: per-machine dev-loop telemetry, not shared history`n$Entry`n"
    [System.IO.File]::AppendAllText($gitignorePath, $block, $Utf8NoBom)
}

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

# Lives inside the project (.claude\rajesh-devkit\) rather than a
# machine-global path, so it's discoverable without knowing a hash formula -
# gitignored automatically since it's per-machine data, not shared history.
$telemetryDir = Join-Path $projectDir '.claude\rajesh-devkit'
New-Item -ItemType Directory -Force -Path $telemetryDir | Out-Null
Ensure-GitignoreEntry -ProjectDir $projectDir -Entry '.claude/rajesh-devkit/'
$snapshotPath = Join-Path $telemetryDir 'telemetry.snapshot.json'
$telemetryPath = Join-Path $telemetryDir 'telemetry.jsonl'

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
        $line = @{
            event     = 'milestone_shipped'
            milestone = $current[$key].display
            timestamp = $nowUtc
        } | ConvertTo-Json -Compress
        [System.IO.File]::AppendAllText($telemetryPath, $line + [Environment]::NewLine, $Utf8NoBom)
    }
}

$snapshot = @{}
foreach ($key in $current.Keys) { $snapshot[$key] = $current[$key].done }
[System.IO.File]::WriteAllText($snapshotPath, ($snapshot | ConvertTo-Json -Compress), $Utf8NoBom)

exit 0
