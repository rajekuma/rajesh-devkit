[CmdletBinding()]
param()

# Stop hook: reads the JSON the harness pipes on stdin, looks for the first
# unchecked milestone in the host project's PROGRESS.md, and if found, blocks
# the stop (exit 2) with a stderr instruction telling Claude what to do next.
# Exits 0 (allow the stop) in every other case: no PROGRESS.md, no unchecked
# milestone left, the project has its own loop skill, or the nudge cap is hit.

$raw = [Console]::In.ReadToEnd()
$hookInput = $null
if ($raw) {
    try { $hookInput = $raw | ConvertFrom-Json } catch { $hookInput = $null }
}

# The harness's own recursion guard: this Stop is already a continuation of a
# previous Stop-hook block. Don't stack another one on top of it.
if ($hookInput -and $hookInput.stop_hook_active -eq $true) {
    exit 0
}

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir -or -not (Test-Path -LiteralPath $projectDir)) {
    exit 0
}

# A project with its own loop skill (e.g. a `spec-loop`-style skill) owns its
# stop conditions deliberately - an unconditional Stop hook would fight them
# (nudging past a reviewer "discuss" verdict or a Phase-boundary pause the
# skill chose on purpose). Defer entirely rather than guess which pause is real.
$ownLoopSkill = Join-Path $projectDir '.claude\skills\spec-loop\SKILL.md'
if (Test-Path -LiteralPath $ownLoopSkill) {
    exit 0
}

$progressPath = Join-Path $projectDir 'PROGRESS.md'
if (-not (Test-Path -LiteralPath $progressPath)) {
    exit 0
}

$milestone = $null
foreach ($line in Get-Content -LiteralPath $progressPath) {
    # Milestone table row: | # | Milestone name | <not-started glyph> | ...
    if ($line -match '^\s*\|\s*([\w.]+)\s*\|\s*(.+?)\s*\|\s*(⬜|⏳)\s*(\||$)') {
        $milestone = "M$($Matches[1]) - $($Matches[2].Trim())"
        break
    }
    # Plain markdown task list: - [ ] <text>
    if ($line -match '^\s*-\s*\[\s*\]\s*(.+)$') {
        $milestone = $Matches[1].Trim()
        break
    }
}

if (-not $milestone) {
    exit 0
}

# Runaway-loop guard: a counter keyed to this project + this exact milestone,
# capped at 8 nudges. State lives outside the repo (OS temp) so it never gets
# committed and never leaks between different projects sharing this plugin.
$projectHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($projectDir))
) -replace '-', ''
$stateDir = Join-Path $env:TEMP 'rajesh-devkit-continue-loop'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$statePath = Join-Path $stateDir "$projectHash.json"

$count = 1
if (Test-Path -LiteralPath $statePath) {
    $previous = $null
    try { $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $previous = $null }
    if ($previous -and $previous.milestone -eq $milestone) {
        $count = [int]$previous.count + 1
    }
}

if ($count -gt 8) {
    Write-Output "continue-loop: '$milestone' hit the 8-nudge cap without shipping - stopping instead of looping forever. Delete $statePath to reset the counter."
    Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
    exit 0
}

@{ milestone = $milestone; count = $count } | ConvertTo-Json -Compress | Set-Content -LiteralPath $statePath -Encoding utf8

$message = "Next milestone from PROGRESS.md: $milestone. Implement it with strict TDD " +
    "(red-green, one acceptance criterion at a time per this project's own testing " +
    "conventions), then invoke the devkit-reviewer subagent against the diff before treating " +
    "it as done."
[Console]::Error.WriteLine($message)
exit 2
