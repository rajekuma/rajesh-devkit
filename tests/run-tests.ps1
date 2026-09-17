[CmdletBinding()]
param()

# Regression suite for rajesh-devkit itself.
#
# Every component in this plugin was verified once, by hand, at the moment it
# was written. That is real verification but it is not a regression suite:
# nothing catches an edit next month that silently breaks something which
# worked today. For a plugin whose whole point is running unattended, a quiet
# regression is the most likely way it fails.
#
# Two kinds of test here, and the second kind is the one that matters:
#
#   Static  - the plugin's own files are well-formed (scripts parse, agent and
#             skill frontmatter is valid, hooks point at files that exist, no
#             raw astral emoji in .ps1 source).
#   Behavioral - the hook scripts are actually executed against throwaway
#             fixture projects in $env:TEMP, and their real exit codes and
#             real stderr are asserted. Exit code 2 plus the right message IS
#             this plugin's contract with the harness; testing the contract
#             beats testing internals, and it survives refactoring.
#
# No Pester, no modules, no install step - plain PowerShell 5.1, so it runs
# anywhere the plugin itself runs.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-tests.ps1

$ErrorActionPreference = 'Stop'
$PluginRoot = Split-Path -Parent $PSScriptRoot

$script:Passed = 0
$script:Failed = 0
$script:Failures = @()
$script:CurrentGroup = ''

function Group($name) {
    $script:CurrentGroup = $name
    Write-Host ""
    Write-Host "  $name" -ForegroundColor Cyan
}

function Ok($name) {
    $script:Passed++
    Write-Host "    PASS  $name" -ForegroundColor DarkGray
}

function Fail($name, $detail) {
    $script:Failed++
    $script:Failures += "[$script:CurrentGroup] $name`n          $detail"
    Write-Host "    FAIL  $name" -ForegroundColor Red
    Write-Host "          $detail" -ForegroundColor Red
}

function Assert-True($condition, $name, $detail) {
    if ($condition) { Ok $name } else { Fail $name $detail }
}

function Assert-Equal($expected, $actual, $name) {
    if ($expected -eq $actual) { Ok $name }
    else { Fail $name "expected '$expected', got '$actual'" }
}

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

# A throwaway project directory the hook scripts can be pointed at. Nothing
# here touches the real repo or any real host project.
function New-FixtureProject {
    param([string]$ProgressContent, [hashtable]$Specs)

    $dir = Join-Path $env:TEMP ("devkit-test-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ($ProgressContent) {
        [System.IO.File]::WriteAllText(
            (Join-Path $dir 'PROGRESS.md'), $ProgressContent,
            (New-Object System.Text.UTF8Encoding($false)))
    }
    if ($Specs) {
        $specsDir = Join-Path $dir 'specs'
        New-Item -ItemType Directory -Force -Path $specsDir | Out-Null
        foreach ($k in $Specs.Keys) {
            [System.IO.File]::WriteAllText(
                (Join-Path $specsDir $k), $Specs[$k],
                (New-Object System.Text.UTF8Encoding($false)))
        }
    }
    return $dir
}

function Remove-Fixture {
    param([string]$Dir)
    # Also clear the per-project nudge state this run created in TEMP, so a
    # repeat run of the suite starts from the same clean slate.
    $hash = [System.BitConverter]::ToString(
        [System.Security.Cryptography.MD5]::Create().ComputeHash(
            [Text.Encoding]::UTF8.GetBytes($Dir))) -replace '-', ''
    $state = Join-Path $env:TEMP "rajesh-devkit-continue-loop\$hash.json"
    Remove-Item -LiteralPath $state -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue
}

# Runs a hook script exactly the way the harness does: separate process,
# stdin fed from a file, stdout and stderr captured separately, real exit
# code returned. Anything less faithful than this can pass while the actual
# hook is broken.
function Invoke-HookScript {
    param([string]$Script, [string]$ProjectDir, [string]$StdinJson = '')

    $tmp = Join-Path $env:TEMP ([Guid]::NewGuid().ToString('N'))
    $inFile  = "$tmp.in";  $outFile = "$tmp.out";  $errFile = "$tmp.err"
    [System.IO.File]::WriteAllText($inFile, $StdinJson)

    $prev = $env:CLAUDE_PROJECT_DIR
    $env:CLAUDE_PROJECT_DIR = $ProjectDir
    # The hooks are Node now (so they run on macOS/Linux too - see
    # hooks/hooks.json). This harness is still PowerShell and still only runs
    # on Windows; porting it is phase two. It only ever spawns the hook as a
    # separate process and asserts on exit code and streams, so it verifies
    # the Node implementations exactly as faithfully as it did the .ps1 ones.
    $full = Join-Path $PluginRoot $Script
    if ($Script -like '*.js') {
        $exe = 'node'
        $argList = @($full)
    } else {
        $exe = 'powershell.exe'
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $full)
    }
    try {
        $p = Start-Process -FilePath $exe -ArgumentList $argList `
            -RedirectStandardInput $inFile -RedirectStandardOutput $outFile `
            -RedirectStandardError $errFile -NoNewWindow -Wait -PassThru
        return [pscustomobject]@{
            ExitCode = $p.ExitCode
            Stdout   = (Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue)
            Stderr   = (Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue)
        }
    } finally {
        $env:CLAUDE_PROJECT_DIR = $prev
        Remove-Item -LiteralPath $inFile, $outFile, $errFile -ErrorAction SilentlyContinue
    }
}

$LOCK = [char]::ConvertFromUtf32(0x1F512)
$VS16 = [char]0xFE0F
$NOTSTARTED = [char]::ConvertFromUtf32(0x2B1C)

$SampleProgress = @"
# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | User login | $NOTSTARTED |
| 2 | Password reset | $NOTSTARTED |
"@

Write-Host ""
Write-Host "rajesh-devkit regression suite" -ForegroundColor White

# ---------------------------------------------------------------------------
Group "Static: scripts parse"
# ---------------------------------------------------------------------------
foreach ($f in (Get-ChildItem -Path (Join-Path $PluginRoot 'scripts') -Filter '*.ps1' -File)) {
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
    Assert-True (-not $errors -or $errors.Count -eq 0) "$($f.Name) parses" `
        ($(if ($errors) { ($errors | ForEach-Object { $_.Message }) -join '; ' } else { '' }))
}

# ---------------------------------------------------------------------------
Group "Static: no raw astral emoji in .ps1 source"
# ---------------------------------------------------------------------------
# Regression guard for a bug this plugin actually hit: a BOM-less .ps1 file's
# 4-byte UTF-8 characters (most emoji, including the lock marker) get misread
# by PowerShell 5.1's default-codepage script parsing - a real syntax error,
# not a display glitch. Build such glyphs from their codepoint instead. A
# lead byte of 0xF0-0xF4 is exactly a 4-byte UTF-8 sequence.
foreach ($f in (Get-ChildItem -Path (Join-Path $PluginRoot 'scripts') -Filter '*.ps1' -File)) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $bad = $false
    foreach ($b in $bytes) { if ($b -ge 0xF0 -and $b -le 0xF4) { $bad = $true; break } }
    Assert-True (-not $bad) "$($f.Name) has no 4-byte UTF-8 literal" `
        "found an astral-plane character - build it with [char]::ConvertFromUtf32() instead"
}

# ---------------------------------------------------------------------------
Group "Static: hook scripts (Node)"
# ---------------------------------------------------------------------------
# The hooks are Node so they run on macOS and Linux too. `node --check`
# parses without executing - the same guarantee the PowerShell parser check
# above gives, and worth having because a syntax error in a hook is a silent
# failure: the harness just sees a non-zero exit it can't explain.
$jsFiles = @(Get-ChildItem -Path (Join-Path $PluginRoot 'scripts') -Filter '*.js' -File -Recurse)
Assert-True ($jsFiles.Count -ge 5) "the Node hooks and their shared lib exist" `
    "expected at least 5 .js files under scripts/, found $($jsFiles.Count)"
foreach ($f in $jsFiles) {
    $null = & node --check $f.FullName 2>&1
    Assert-Equal 0 $LASTEXITCODE "$($f.Name) parses (node --check)"

    # ASCII-only source. JS has no parsing bug around astral characters the
    # way a BOM-less .ps1 did, but keeping these files pure ASCII means no
    # editor, codepage or transfer mishap can corrupt a glyph the matchers
    # depend on - the escapes in lib/devkit.js are there for that reason.
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $nonAscii = $false
    foreach ($b in $bytes) { if ($b -gt 0x7F) { $nonAscii = $true; break } }
    Assert-True (-not $nonAscii) "$($f.Name) is pure ASCII" `
        "found a non-ASCII byte - use a \u{...} escape instead of a literal"
}

# No absolute Windows paths baked into a hook.
foreach ($f in $jsFiles) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
    Assert-True ($text -notmatch "'[A-Za-z]:\\\\") "$($f.Name) has no absolute Windows path literal" `
        "use path.join so the hook works on macOS and Linux"
}

# Every hook must be launched with node. Checked structurally, against the
# parsed `command` values - NOT by grepping the file for "powershell", which
# was the first version of this test and failed three ways at once: it hit
# the word in hooks.json's own description, in a comment in lib/devkit.js,
# and in run-verify.js, which invokes powershell.exe on purpose to run a
# Windows project's verify.ps1. Matching prose is not measuring behaviour.
$hooks = Get-Content -LiteralPath (Join-Path $PluginRoot 'hooks\hooks.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$commands = @()
foreach ($event in $hooks.hooks.PSObject.Properties) {
    foreach ($entry in $event.Value) {
        foreach ($h in $entry.hooks) { $commands += $h.command }
    }
}
Assert-True ($commands.Count -ge 4) "hooks.json declares at least 4 hooks" "found $($commands.Count)"
$nonNode = @($commands | Where-Object { $_ -ne 'node' })
Assert-True ($nonNode.Count -eq 0) "every hooks.json command is node" `
    "these would not run on macOS or Linux: $($nonNode -join ', ')"

# ---------------------------------------------------------------------------
Group "Static: agent and skill frontmatter"
# ---------------------------------------------------------------------------
$componentFiles = @()
$componentFiles += Get-ChildItem -Path (Join-Path $PluginRoot 'agents') -Filter '*.md' -File |
    ForEach-Object { [pscustomobject]@{ Path = $_.FullName; Expected = $_.BaseName; Kind = 'agent' } }
$componentFiles += Get-ChildItem -Path (Join-Path $PluginRoot 'skills') -Directory |
    ForEach-Object {
        $s = Join-Path $_.FullName 'SKILL.md'
        if (Test-Path -LiteralPath $s) {
            [pscustomobject]@{ Path = $s; Expected = $_.Name; Kind = 'skill' }
        }
    }

foreach ($c in $componentFiles) {
    $text = Get-Content -LiteralPath $c.Path -Raw -Encoding UTF8
    $label = "$($c.Kind) $($c.Expected)"

    if ($text -notmatch '(?s)^---\r?\n(.*?)\r?\n---') {
        Fail "$label frontmatter" "no --- delimited frontmatter block at the top of the file"
        continue
    }
    $fm = $Matches[1]

    $nameOk = $fm -match '(?m)^name:\s*(\S+)\s*$'
    $declaredName = if ($nameOk) { $Matches[1] } else { '' }
    Assert-True $nameOk "$label declares name" "frontmatter has no 'name:' field"
    if ($nameOk) {
        Assert-Equal $c.Expected $declaredName "$label name matches its file/folder"
    }

    Assert-True ($fm -match '(?m)^description:\s*\S') "$label declares description" `
        "frontmatter has no 'description:' field - the harness uses it to decide when to trigger"

    # Every component in this plugin is namespaced, so it can never collide
    # with a host project's own same-named skill or agent.
    Assert-True ($c.Expected -like 'devkit-*') "$label is devkit- prefixed" `
        "component names must stay namespaced to avoid colliding with host-project assets"
}

# ---------------------------------------------------------------------------
Group "Static: hooks.json points at real scripts"
# ---------------------------------------------------------------------------
$hooksPath = Join-Path $PluginRoot 'hooks\hooks.json'
$hooks = Get-Content -LiteralPath $hooksPath -Raw -Encoding UTF8 | ConvertFrom-Json
$referenced = 0
foreach ($event in $hooks.hooks.PSObject.Properties) {
    foreach ($entry in $event.Value) {
        foreach ($h in $entry.hooks) {
            $fileArg = $h.args | Where-Object { $_ -like '*scripts/*' }
            foreach ($fa in $fileArg) {
                $referenced++
                $rel = $fa -replace '\$\{CLAUDE_PLUGIN_ROOT\}/', ''
                $full = Join-Path $PluginRoot ($rel -replace '/', '\')
                Assert-True (Test-Path -LiteralPath $full) "$($event.Name) -> $rel exists" `
                    "hooks.json references a script that isn't in the repo"
            }
        }
    }
}
Assert-True ($referenced -ge 4) "hooks.json wires at least 4 scripts" "only found $referenced"

# ---------------------------------------------------------------------------
Group "Behavioral: sensitive-marker matching (the escalation gate)"
# ---------------------------------------------------------------------------
# This gate fails OPEN - an unrecognised marker means a milestone that should
# have paused for a human gets auto-delegated silently. These cases are the
# realistic ways a model renders the prefix. Four of them were genuine misses
# under the original exact-substring matcher.
$markerCases = @(
    @{ n = 'glyph + space (canonical)'; body = "1. $LOCK SENSITIVE: alters the users table"; want = $true },
    @{ n = 'glyph, no space';           body = "1. ${LOCK}SENSITIVE: alters the users table"; want = $true },
    @{ n = 'glyph + variation selector'; body = "1. $LOCK$VS16 SENSITIVE: touches auth"; want = $true },
    @{ n = 'glyph omitted entirely';    body = "1. SENSITIVE: touches auth"; want = $true },
    @{ n = 'wrapped in bold markdown';  body = "1. **$LOCK SENSITIVE:** touches auth"; want = $true },
    @{ n = 'space before the colon';    body = "1. $LOCK SENSITIVE : touches auth"; want = $true },
    @{ n = 'lowercase prose does not trip'; body = "This is not sensitive: just a note"; want = $false },
    @{ n = 'ordinary requirement';      body = "1. Returns 404 for a missing id"; want = $false }
)

foreach ($case in $markerCases) {
    $spec = "# Spec: User login`n`nMilestone: 1`n`n## Behaviour / requirements`n`n$($case.body)`n"
    $dir = New-FixtureProject -ProgressContent $SampleProgress -Specs @{ 'user-login.md' = $spec }
    try {
        $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
        $escalated = $r.Stderr -and $r.Stderr.Contains('STOP before delegating')
        Assert-Equal $case.want $escalated "escalates: $($case.n)"
    } finally { Remove-Fixture $dir }
}

# ---------------------------------------------------------------------------
Group "Behavioral: continue-loop nudge routing"
# ---------------------------------------------------------------------------
# No spec yet -> should nudge toward devkit-specify.
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 2 $r.ExitCode "blocks the stop (exit 2) when a milestone is unstarted"
    Assert-True ($r.Stderr -like '*devkit-specify*') "nudges toward devkit-specify when no spec exists" `
        "stderr was: $($r.Stderr)"
    Assert-True ($r.Stderr -like '*User login*') "names the first unstarted milestone" `
        "stderr was: $($r.Stderr)"
} finally { Remove-Fixture $dir }

# Spec exists, not sensitive -> should nudge toward implementation + review + ship.
$plainSpec = "# Spec: User login`n`nMilestone: 1`n`n## Acceptance criteria`n`n- [ ] It works`n"
$dir = New-FixtureProject -ProgressContent $SampleProgress -Specs @{ 'user-login.md' = $plainSpec }
try {
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 2 $r.ExitCode "blocks the stop when a spec is ready to implement"
    Assert-True ($r.Stderr -like '*devkit-reviewer*') "nudge names devkit-reviewer" "stderr: $($r.Stderr)"
    Assert-True ($r.Stderr -like '*devkit-ship*') "nudge names devkit-ship preflight" "stderr: $($r.Stderr)"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: continue-loop exits quietly when it should"
# ---------------------------------------------------------------------------
# The harness's own recursion guard.
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{"stop_hook_active":true}'
    Assert-Equal 0 $r.ExitCode "allows the stop when stop_hook_active is true"
} finally { Remove-Fixture $dir }

# No PROGRESS.md at all.
$dir = New-FixtureProject
try {
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $r.ExitCode "allows the stop when there is no PROGRESS.md"
} finally { Remove-Fixture $dir }

# Every milestone already done.
$doneProgress = "# Progress`n`n| # | Milestone | Status |`n|---|---|---|`n| 1 | User login | done |`n"
$dir = New-FixtureProject -ProgressContent $doneProgress
try {
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $r.ExitCode "allows the stop when nothing is unstarted"
} finally { Remove-Fixture $dir }

# A project with its own loop skill owns its own stop conditions.
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $own = Join-Path $dir '.claude\skills\spec-loop'
    New-Item -ItemType Directory -Force -Path $own | Out-Null
    Set-Content -LiteralPath (Join-Path $own 'SKILL.md') -Value '# own loop' -Encoding UTF8
    $r = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $r.ExitCode "defers entirely to a project's own spec-loop skill"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: ALL hooks defer to a project's own loop skill"
# ---------------------------------------------------------------------------
# continue-loop deferring on its own is not enough, and that gap was a real
# bug. session-welcome kept advertising the devkit chain and signing off with
# "the Stop hook will nudge automatically" - false precisely BECAUSE
# continue-loop had deferred. track-milestones kept creating
# .claude/rajesh-devkit/ and appending a .gitignore line on every Edit, to log
# "shipped" events whose matching "started" events continue-loop would never
# write, so the data could never be read back. Both must stand down together.
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $own = Join-Path $dir '.claude\skills\spec-loop'
    New-Item -ItemType Directory -Force -Path $own | Out-Null
    Set-Content -LiteralPath (Join-Path $own 'SKILL.md') -Value '# own loop' -Encoding UTF8

    $w = Invoke-HookScript -Script 'scripts\session-welcome.js' -ProjectDir $dir -StdinJson '{"source":"startup"}'
    Assert-Equal 0 $w.ExitCode "session-welcome exits 0 when the project owns its loop"
    Assert-True ($w.Stdout -like '*defers to it*') "session-welcome says the Stop hook defers" `
        "stdout: $($w.Stdout)"
    Assert-True ($w.Stdout -notlike '*nudge automatically*') "session-welcome drops the false nudge promise" `
        "it still claims the Stop hook will nudge, which cannot happen here"
    Assert-True ($w.Stdout -notlike '*spec this feature*') "session-welcome stops steering toward devkit-specify" `
        "stdout: $($w.Stdout)"

    $t = Invoke-HookScript -Script 'scripts\track-milestones.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $t.ExitCode "track-milestones exits 0 when the project owns its loop"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dir '.claude\rajesh-devkit'))) `
        "track-milestones writes no telemetry folder" "it created .claude/rajesh-devkit/ anyway"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dir '.gitignore'))) `
        "track-milestones touches no .gitignore" "it appended to the host project's .gitignore anyway"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: escalation shows once per milestone, not every nudge"
# ---------------------------------------------------------------------------
$sensSpec = "# Spec: User login`n`nMilestone: 1`n`n## Behaviour / requirements`n`n1. $LOCK SENSITIVE: touches auth`n"
$dir = New-FixtureProject -ProgressContent $SampleProgress -Specs @{ 'user-login.md' = $sensSpec }
try {
    $first  = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    $second = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Assert-True ($first.Stderr -like '*STOP before delegating*') "first nudge escalates" "stderr: $($first.Stderr)"
    Assert-True ($second.Stderr -notlike '*STOP before delegating*') "second nudge does not re-escalate" `
        "escalation repeated on the same milestone - escalationShown state is not sticking"
    Assert-Equal 2 $second.ExitCode "second nudge still blocks the stop (with the normal message)"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: runaway-loop guard"
# ---------------------------------------------------------------------------
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $last = $null
    for ($i = 1; $i -le 9; $i++) {
        $last = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    }
    Assert-Equal 0 $last.ExitCode "stops nudging after the 8-nudge cap"
    Assert-True ($last.Stdout -like '*8-nudge cap*') "explains why it stopped" "stdout: $($last.Stdout)"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: telemetry and gitignore side effects"
# ---------------------------------------------------------------------------
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $null = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    $tel = Join-Path $dir '.claude\rajesh-devkit\telemetry.jsonl'
    Assert-True (Test-Path -LiteralPath $tel) "writes a milestone_started telemetry event" "no telemetry.jsonl created"
    if (Test-Path -LiteralPath $tel) {
        # Checked in raw bytes on purpose. A BOM is a byte-level fact, and the
        # obvious string form of this test is silently vacuous: .NET's
        # String.StartsWith is culture-sensitive by default and U+FEFF is a
        # zero-width ignorable character, so StartsWith([char]0xFEFF) returns
        # true for every string - exactly like StartsWith('').
        $telBytes = [System.IO.File]::ReadAllBytes($tel)
        $hasBom = ($telBytes.Length -ge 3 -and $telBytes[0] -eq 0xEF -and
                   $telBytes[1] -eq 0xBB -and $telBytes[2] -eq 0xBF)
        Assert-True (-not $hasBom) "telemetry has no UTF-8 BOM" `
            "a BOM on line 1 breaks strict line-by-line JSON parsing"
        $firstLine = (Get-Content -LiteralPath $tel -TotalCount 1)
        $parsed = $null
        try { $parsed = $firstLine | ConvertFrom-Json } catch { $parsed = $null }
        Assert-True ($parsed -and $parsed.event -eq 'milestone_started') "telemetry line is valid JSON" `
            "could not parse: $firstLine"
    }
    $gi = Join-Path $dir '.gitignore'
    Assert-True (Test-Path -LiteralPath $gi) ".gitignore created for the telemetry folder" "no .gitignore written"
    if (Test-Path -LiteralPath $gi) {
        $giText = Get-Content -LiteralPath $gi -Raw -Encoding UTF8
        Assert-True ($giText -like '*.claude/rajesh-devkit/*') ".gitignore covers .claude/rajesh-devkit/" `
            "gitignore content: $giText"
    }
} finally { Remove-Fixture $dir }

# Idempotency: the gitignore entry must not be appended twice.
$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $null = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    Remove-Item -LiteralPath (Join-Path $env:TEMP ("rajesh-devkit-continue-loop\" + (
        [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash(
            [Text.Encoding]::UTF8.GetBytes($dir))) -replace '-', '') + '.json')) -ErrorAction SilentlyContinue
    $null = Invoke-HookScript -Script 'scripts\continue-loop.js' -ProjectDir $dir -StdinJson '{}'
    $giText = Get-Content -LiteralPath (Join-Path $dir '.gitignore') -Raw -Encoding UTF8
    $count = ([regex]::Matches($giText, [regex]::Escape('.claude/rajesh-devkit/'))).Count
    Assert-Equal 1 $count "gitignore entry is written exactly once across runs"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: session-welcome agrees with continue-loop"
# ---------------------------------------------------------------------------
# devkit-help's whole promise is that the on-demand check and the automatic
# banner never drift apart. If these two ever disagree about whether a
# milestone is sensitive, that promise is broken.
$dir = New-FixtureProject -ProgressContent $SampleProgress -Specs @{ 'user-login.md' = $sensSpec }
try {
    $w = Invoke-HookScript -Script 'scripts\session-welcome.js' -ProjectDir $dir -StdinJson '{"source":"startup"}'
    Assert-Equal 0 $w.ExitCode "session-welcome never blocks"
    Assert-True ($w.Stdout -like '*SENSITIVE*') "session-welcome flags the same sensitive spec" `
        "stdout: $($w.Stdout)"
} finally { Remove-Fixture $dir }

$dir = New-FixtureProject -ProgressContent $SampleProgress
try {
    $w = Invoke-HookScript -Script 'scripts\session-welcome.js' -ProjectDir $dir -StdinJson '{"source":"startup"}'
    Assert-True ($w.Stdout -like '*User login*') "session-welcome names the next milestone" "stdout: $($w.Stdout)"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: run-verify is a silent no-op without a host verify script"
# ---------------------------------------------------------------------------
$dir = New-FixtureProject
try {
    $r = Invoke-HookScript -Script 'scripts\run-verify.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $r.ExitCode "run-verify exits 0 when the project has no verify script"
    Assert-True ([string]::IsNullOrWhiteSpace($r.Stdout)) "run-verify stays silent when absent" `
        "unexpected output: $($r.Stdout)"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
Group "Behavioral: run-verify passes a host verify script's exit code through"
# ---------------------------------------------------------------------------
# The whole contract of this hook is that it does NOT remap the exit code -
# the host project's own convention decides whether Claude sees the failure.
# The lookup is multi-language now (verify.js, verify.sh, verify.ps1) because
# the old .ps1-only contract was Windows-only; verify.js is checked here
# because node is the one interpreter guaranteed to exist.
foreach ($case in @(
    @{ code = 0; name = 'success' },
    @{ code = 2; name = 'failure (2 = surface it to Claude)' },
    @{ code = 1; name = 'failure (1)' }
)) {
    $dir = New-FixtureProject
    try {
        $claudeDir = Join-Path $dir '.claude'
        New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
        [System.IO.File]::WriteAllText(
            (Join-Path $claudeDir 'verify.js'),
            "process.stdout.write('verify ran');" + [Environment]::NewLine +
            "process.exit($($case.code));" + [Environment]::NewLine,
            (New-Object System.Text.UTF8Encoding($false)))
        $r = Invoke-HookScript -Script 'scripts\run-verify.js' -ProjectDir $dir -StdinJson '{}'
        Assert-Equal $case.code $r.ExitCode "run-verify passes through exit $($case.code) - $($case.name)"
        Assert-True ($r.Stdout -like '*verify ran*') "run-verify runs the host script (exit $($case.code))" `
            "stdout was: $($r.Stdout)"
    } finally { Remove-Fixture $dir }
}

# A verify script it cannot execute must not be silently skipped: exit 0 so a
# setup problem doesn't block every edit, but say so on stderr, because a
# verify gate that quietly never runs is the "unrun check assumed green"
# failure devkit-ship exists to prevent.
$dir = New-FixtureProject
try {
    $claudeDir = Join-Path $dir '.claude'
    New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
    Set-Content -LiteralPath (Join-Path $claudeDir 'verify.ps1') -Value 'exit 0' -Encoding UTF8
    $r = Invoke-HookScript -Script 'scripts\run-verify.js' -ProjectDir $dir -StdinJson '{}'
    Assert-Equal 0 $r.ExitCode "run-verify still exits 0 for a .ps1 verify script"
} finally { Remove-Fixture $dir }

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host ("-" * 60)
if ($script:Failed -eq 0) {
    Write-Host "  $($script:Passed) passed, 0 failed" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "  $($script:Passed) passed, $($script:Failed) FAILED" -ForegroundColor Red
    Write-Host ""
    foreach ($f in $script:Failures) { Write-Host "  - $f" -ForegroundColor Red }
    Write-Host ""
    exit 1
}
