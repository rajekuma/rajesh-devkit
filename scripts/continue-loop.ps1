[CmdletBinding()]
param()

# Stop hook: reads the JSON the harness pipes on stdin, looks for the first
# unchecked milestone in the host project's PROGRESS.md, and if found, blocks
# the stop (exit 2) with a stderr instruction telling Claude what to do next
# - draft a spec first if none exists yet, otherwise implement it. Exits 0
# (allow the stop) in every other case: no PROGRESS.md, no unchecked
# milestone left, the project has its own loop skill, or the nudge cap is hit.

# Windows PowerShell 5.1's -Encoding utf8 always writes a BOM, which breaks a
# strict line-by-line JSON parser on the very first line of the telemetry
# log. Write without one explicitly instead.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Every non-ASCII glyph this script matches against is built from its
# Unicode codepoint, never embedded as a literal in this file's own source.
# Found by actually running this: a BOM-less .ps1 file's multi-byte UTF-8
# literals get misread by PowerShell 5.1's default-codepage script parsing
# (real breakage for a 4-byte/astral character like the lock emoji - a
# "Missing ')' in method call" syntax error). The status glyphs below
# happened to keep matching anyway, but only because the same
# misinterpretation hit both this file's regex literals *and* Get-Content's
# default-encoding reads of PROGRESS.md the same way - mojibake cancelling
# mojibake, not a real fix. Every codepoint here is verified against this
# plugin's own real PROGRESS.md content, not typed from memory.
$GlyphNotStarted = [char]::ConvertFromUtf32(0x2B1C)  # ⬜ WHITE LARGE SQUARE
$GlyphHourglass  = [char]::ConvertFromUtf32(0x23F3)  # ⏳ HOURGLASS FLOWING SAND

# The sensitive-requirement marker, matched on its ASCII keyword alone - the
# lock glyph devkit-specify writes in front of it is deliberately NOT required
# here. This gate fails OPEN (a missed marker means a milestone that should
# have paused for a human gets auto-delegated instead), so it has to tolerate
# every way a probabilistic writer might render the prefix: no space after the
# glyph, a variation selector (U+FE0F) appended to it, the glyph dropped
# entirely, or the whole file read back through the wrong codepage. All of
# those mangle the emoji; none of them touch the ASCII word. Case stays
# significant so ordinary prose ("sensitive: no") can't trip the gate, and
# over-matching is the safe direction anyway - a false positive costs one
# extra question, a false negative costs the entire gate.
$SensitiveMarkerPattern = 'SENSITIVE\s*:'

# Idempotently ensures one line exists in the host project's .gitignore -
# used for the local telemetry/cache folder this plugin writes into, so it
# never gets swept into a commit. Creates .gitignore if it doesn't exist;
# preserves whatever's already there, including a file with no trailing
# newline.
function Ensure-GitignoreEntry {
    param($ProjectDir, $Entry)

    $gitignorePath = Join-Path $ProjectDir '.gitignore'
    $existingText = ''
    if (Test-Path -LiteralPath $gitignorePath) {
        $existingText = Get-Content -LiteralPath $gitignorePath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($null -eq $existingText) { $existingText = '' }
    }
    if (($existingText -split "`r?`n") -contains $Entry) { return }

    $prefix = ''
    if ($existingText.Length -gt 0 -and -not $existingText.EndsWith("`n")) { $prefix = "`n" }
    $block = "$prefix`n# rajesh-devkit: per-machine dev-loop telemetry, not shared history`n$Entry`n"
    [System.IO.File]::AppendAllText($gitignorePath, $block, $Utf8NoBom)
}

# Finds a spec file for a milestone, matching devkit-specify's own
# specs/<kebab-case-feature>.md convention. Tries the kebab-case guess first
# (name with any trailing "(...)" qualifier stripped), then falls back to
# scanning each spec's header line for this milestone's number, in case the
# filename doesn't follow the convention. Returns $null if nothing matches -
# that's a normal outcome (milestone hasn't been spec'd yet), not an error.
function Find-SpecForMilestone {
    param($ProjectDir, $MilestoneNumber, $MilestoneName)

    $specsDir = Join-Path $ProjectDir 'specs'
    if (-not (Test-Path -LiteralPath $specsDir)) { return $null }

    $core = $MilestoneName -replace '\s*\([^)]*\)\s*$', ''
    $kebab = ($core.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
    if ($kebab) {
        $guess = Join-Path $specsDir "$kebab.md"
        if (Test-Path -LiteralPath $guess) { return $guess }
    }

    if ($MilestoneNumber) {
        $pattern = "Milestone:.*\bM?$([regex]::Escape($MilestoneNumber))\b"
        foreach ($file in (Get-ChildItem -LiteralPath $specsDir -Filter '*.md' -File -ErrorAction SilentlyContinue)) {
            $head = Get-Content -LiteralPath $file.FullName -TotalCount 5 -Encoding UTF8 -ErrorAction SilentlyContinue
            foreach ($line in $head) {
                if ($line -match $pattern) { return $file.FullName }
            }
        }
    }
    return $null
}

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

$milestoneNumber = $null
$milestoneName = $null
foreach ($line in (Get-Content -LiteralPath $progressPath -Encoding UTF8)) {
    # Milestone table row: | # | Milestone name | <not-started glyph> | ...
    if ($line -match "^\s*\|\s*([\w.]+)\s*\|\s*(.+?)\s*\|\s*($GlyphNotStarted|$GlyphHourglass)\s*(\||`$)") {
        $milestoneNumber = $Matches[1]
        $milestoneName = $Matches[2].Trim()
        break
    }
    # Plain markdown task list: - [ ] <text>
    if ($line -match '^\s*-\s*\[\s*\]\s*(.+)$') {
        $milestoneName = $Matches[1].Trim()
        break
    }
}

if (-not $milestoneName) {
    exit 0
}

$milestone = if ($milestoneNumber) { "M$milestoneNumber - $milestoneName" } else { $milestoneName }
$specPath = Find-SpecForMilestone -ProjectDir $projectDir -MilestoneNumber $milestoneNumber -MilestoneName $milestoneName

# Sensitive-milestone escalation gate: devkit-specify marks a requirement
# "SENSITIVE:" (glyph-prefixed when it renders cleanly) when it touches an
# existing invariant, a security/auth boundary, a data-model change, an
# external integration, or a
# backward-compatibility break (see its own SKILL.md). If the spec has one,
# this milestone shouldn't get automatically nudged toward standard
# delegation the same way an ordinary one would - the escalation message
# below asks the orchestrator to stop and ask the user whether to implement
# it directly at higher reasoning instead. Shown once per milestone (see
# $escalationShown below), not on every repeat nudge - once it's been
# surfaced, a human has had the chance to act on it.
$isSensitive = $false
if ($specPath) {
    $specContent = Get-Content -LiteralPath $specPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($specContent -and $specContent -cmatch $SensitiveMarkerPattern) {
        $isSensitive = $true
    }
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
$escalationShown = $false
if (Test-Path -LiteralPath $statePath) {
    $previous = $null
    try { $previous = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $previous = $null }
    if ($previous -and $previous.milestone -eq $milestone) {
        $count = [int]$previous.count + 1
        if ($previous.PSObject.Properties.Match('escalationShown').Count -gt 0) {
            $escalationShown = [bool]$previous.escalationShown
        }
    }
}

if ($count -gt 8) {
    Write-Output "continue-loop: '$milestone' hit the 8-nudge cap without shipping - stopping instead of looping forever. Delete $statePath to reset the counter."
    Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
    exit 0
}

$showEscalation = $isSensitive -and -not $escalationShown
if ($showEscalation) { $escalationShown = $true }

[System.IO.File]::WriteAllText(
    $statePath,
    (@{ milestone = $milestone; count = $count; escalationShown = $escalationShown } | ConvertTo-Json -Compress),
    $Utf8NoBom
)

# Telemetry: log a "started" event the first time this milestone is seen (not
# on every repeat nudge) - regardless of whether the nudge below is toward
# specifying, implementing, or escalating, since from the user's perspective
# work on this milestone began the moment it was first mentioned.
# track-milestones.ps1 logs the matching "shipped" event when PROGRESS.md
# marks it done; devkit-stats pairs the two by name. Lives inside the
# project (.claude\rajesh-devkit\) rather than a machine-global path, so
# it's discoverable without knowing a hash formula - gitignored
# automatically since it's per-machine data, not something to commit or
# share via git.
if ($count -eq 1) {
    $telemetryDir = Join-Path $projectDir '.claude\rajesh-devkit'
    New-Item -ItemType Directory -Force -Path $telemetryDir | Out-Null
    Ensure-GitignoreEntry -ProjectDir $projectDir -Entry '.claude/rajesh-devkit/'
    $telemetryPath = Join-Path $telemetryDir 'telemetry.jsonl'
    $line = @{
        event     = 'milestone_started'
        milestone = $milestone
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
    [System.IO.File]::AppendAllText($telemetryPath, $line + [Environment]::NewLine, $Utf8NoBom)
}

if ($showEscalation) {
    $message = "Next milestone from PROGRESS.md: $milestone. Its spec ($specPath) flags one " +
        "or more requirements as SENSITIVE (an existing invariant, a security/authorization " +
        "boundary, a data-model change, an external integration, or a backward-compatibility " +
        "break). STOP before delegating to devkit-implementer: ask the user one question " +
        "(e.g. via AskUserQuestion) - implement this milestone directly yourself at higher " +
        "reasoning, or standard delegation to devkit-implementer is fine for this one. Wait " +
        "for their answer before proceeding either way; do not decide this yourself and do " +
        "not auto-delegate. This is a one-time gate for this milestone - once answered, " +
        "proceed with strict TDD as normal and invoke devkit-reviewer when done."
} elseif (-not $specPath) {
    $message = "Next milestone from PROGRESS.md: $milestone. No spec exists for it yet - " +
        "draft one first: say `"spec this feature: $milestoneName`" to invoke devkit-specify " +
        "and write specs/<kebab-case-feature>.md. Once the spec exists, implement it with " +
        "strict TDD (red-green, one acceptance criterion at a time), then invoke the " +
        "devkit-reviewer subagent against the diff. Once it returns a ship verdict, run " +
        "the devkit-ship subagent as a preflight (CI, coverage, advisories, secrets, open " +
        "follow-ups) before treating the milestone as done."
} else {
    $message = "Next milestone from PROGRESS.md: $milestone. Its spec already exists at " +
        "$specPath - implement it with strict TDD (red-green, one acceptance criterion at a " +
        "time per this project's own testing conventions), then invoke the devkit-reviewer " +
        "subagent against the diff. Once it returns a ship verdict, run the devkit-ship " +
        "subagent as a preflight (CI, coverage, advisories, secrets, open follow-ups) " +
        "before treating the milestone as done."
}
[Console]::Error.WriteLine($message)
exit 2
