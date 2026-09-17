[CmdletBinding()]
param()

# SessionStart hook: prints a short "what do I do next" nudge for a project
# with this plugin installed, covering four states - no PROGRESS.md yet
# (bootstrap guidance), an unstarted milestone with no spec (suggest
# devkit-specify), an unstarted milestone with a spec ready (suggest
# devkit-implementer or just continuing), or nothing left to do. Never
# blocks anything; always exits 0.
#
# Also invoked directly (not just as a hook) by the devkit-help skill, which
# runs this same script and relays its output conversationally - so the
# automatic and on-demand paths can never drift out of sync with each other.
#
# Whether SessionStart hook stdout is shown to the user the same way as a
# Stop/PostToolUse hook's stderr has NOT been empirically verified against a
# live harness (this plugin's other hooks were verified by direct invocation
# and inspecting real state files; a SessionStart hook's actual on-screen
# behavior needs a real interactive session to observe, which wasn't
# available while building this). If the automatic banner doesn't appear as
# expected, `devkit-help` is the verified fallback - it just runs this same
# script and relays the result as a normal conversational reply.

# Every non-ASCII glyph this script matches against is built from its
# Unicode codepoint, never embedded as a literal in this file's own source -
# see continue-loop.ps1's comment on the same convention for why (a real,
# reproduced BOM-less-.ps1-source parsing bug on a 4-byte glyph elsewhere).
# Every codepoint here is verified against this plugin's own real
# PROGRESS.md content, not typed from memory.
$GlyphNotStarted = [char]::ConvertFromUtf32(0x2B1C)  # ⬜ WHITE LARGE SQUARE
$GlyphHourglass  = [char]::ConvertFromUtf32(0x23F3)  # ⏳ HOURGLASS FLOWING SAND

# Matched on the ASCII keyword alone, glyph not required - see
# continue-loop.ps1's comment on this pattern for why. Both scripts must stay
# identical here: they implement the same gate for the two cases (this one
# covers a same-turn request, which a Stop hook can't see), so a marker that
# escalates in one and not the other would be worse than neither.
$SensitiveMarkerPattern = 'SENSITIVE\s*:'

$raw = [Console]::In.ReadToEnd()
$hookInput = $null
if ($raw) {
    try { $hookInput = $raw | ConvertFrom-Json } catch { $hookInput = $null }
}

# Only greet on a genuinely new session, not a --resume/--continue, a
# /clear, or a compaction - printing this on every one of those would be
# repetitive noise mid-project. Defaults to showing the message if `source`
# is absent or unrecognised, erring toward being seen at least once rather
# than silently never firing.
if ($hookInput -and $hookInput.source -and $hookInput.source -ne 'startup') {
    exit 0
}

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

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir -or -not (Test-Path -LiteralPath $projectDir)) {
    exit 0
}

$progressPath = Join-Path $projectDir 'PROGRESS.md'
if (-not (Test-Path -LiteralPath $progressPath)) {
    Write-Output @'
rajesh-devkit is installed, but this project has no PROGRESS.md yet - the
one file the loop actually needs to have anything to nudge toward. Before
that:

  1. If you haven't already, talk through what this project actually is
     (the product intent, not conventions) and save it somewhere like
     docs/product_vision.md - a conversation, not a command.
  2. Run `claude init` to generate/update CLAUDE.md from the repo as it
     stands.
  3. Break the vision into milestones and write PROGRESS.md - a table per
     phase, every row starting unstarted, e.g.:

       | # | Milestone | Status |
       |---|---|---|
       | 1 | <name> | (unstarted glyph) |

  4. Optionally seed docs/adr/ if any big, hard-to-reverse decisions are
     already made.

Once PROGRESS.md exists with an unstarted row, this message will say what's
next instead of this.
'@
    exit 0
}

$milestoneNumber = $null
$milestoneName = $null
foreach ($line in (Get-Content -LiteralPath $progressPath -Encoding UTF8)) {
    if ($line -match "^\s*\|\s*([\w.]+)\s*\|\s*(.+?)\s*\|\s*($GlyphNotStarted|$GlyphHourglass)\s*(\||`$)") {
        $milestoneNumber = $Matches[1]
        $milestoneName = $Matches[2].Trim()
        break
    }
    if ($line -match '^\s*-\s*\[\s*\]\s*(.+)$') {
        $milestoneName = $Matches[1].Trim()
        break
    }
}

if (-not $milestoneName) {
    Write-Output "rajesh-devkit: no unstarted milestone found in PROGRESS.md - nothing queued right now. Add a new row when there's a next milestone to work on."
    exit 0
}

$milestone = if ($milestoneNumber) { "M$milestoneNumber - $milestoneName" } else { $milestoneName }
$specPath = Find-SpecForMilestone -ProjectDir $projectDir -MilestoneNumber $milestoneNumber -MilestoneName $milestoneName

$isSensitive = $false
if ($specPath) {
    $specContent = Get-Content -LiteralPath $specPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($specContent -and $specContent -cmatch $SensitiveMarkerPattern) {
        $isSensitive = $true
    }
}

if ($isSensitive) {
    Write-Output @"
rajesh-devkit: next milestone is $milestone - its spec ($specPath) flags
one or more requirements as SENSITIVE (an existing invariant, a
security/authorization boundary, a data-model change, an external
integration, or a backward-compatibility break). Before implementing:
decide whether to implement this one yourself at higher reasoning instead
of delegating to devkit-implementer, or whether standard delegation is
fine here - that's your call to make, not something to skip past.
"@
} elseif (-not $specPath) {
    Write-Output @"
rajesh-devkit: next milestone is $milestone - no spec yet.
Let's start creating the first spec: say "spec this feature: $milestoneName"
to draft one with devkit-specify. Once it exists, say "implement it" or
just keep working - the Stop hook will nudge automatically when the
session pauses.
"@
} else {
    $relSpec = $specPath.Substring($projectDir.Length).TrimStart('\', '/')
    Write-Output @"
rajesh-devkit: next milestone is $milestone - spec ready at $relSpec.
Say "implement it", or just keep working - the Stop hook will nudge
toward it automatically the next time the session pauses.
"@
}
exit 0
