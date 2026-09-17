[CmdletBinding()]
param(
    [string]$Case = '*',
    [switch]$KeepTemp,
    [switch]$SkipLlm,
    [string]$JudgeModel = 'haiku'
)

# Windows runner for the behavioral evals under evals/.
#
# The official runner (`claude plugin eval`) is the intended way to run these,
# and the case files are written to its schema. On Windows it currently hands
# each case's scaffold path to `bash -c` unescaped, so `C:\Dev\...` arrives as
# `C:Devrajesh-devkit...` and every scaffolded case fails before Claude
# starts. This script exists only to bridge that: it executes the SAME
# case.yaml, scaffold.sh and graders/*.md, driving `claude -p --plugin-dir`
# directly and grading the result itself. Nothing here is Windows-specific in
# the case files, so on macOS/Linux use the official runner instead.
#
# Known differences from the official runner, on purpose:
#   - No --max-turns in this CLI build, so runs are bounded by
#     timeout_seconds only.
#   - llm graders take one judge vote, not three (cheaper; less robust).
#   - Isolation is weaker: --setting-sources local keeps other installed
#     plugins out, but user-level memory may still load.
#   - No ablation arm. tool_used graders are scored here, not just reported.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-evals.ps1
#   powershell ... -File tests\run-evals.ps1 -Case 'ship-*' -KeepTemp

$ErrorActionPreference = 'Stop'
$PluginRoot = Split-Path -Parent $PSScriptRoot
$EvalsDir   = Join-Path $PluginRoot 'evals'
$Utf8NoBom  = New-Object System.Text.UTF8Encoding($false)

# A system-profile WindowsApps entry on PATH is access-denied and makes
# claude's Bash sandbox refuse to start. Drop it (and dead entries) for the
# child processes only.
$env:PATH = (($env:PATH -split ';') | Where-Object {
    $_ -and (Test-Path -LiteralPath $_ -ErrorAction SilentlyContinue)
}) -join ';'

# Git on this machine spawns a detached `git fsmonitor--daemon` on the first
# `git add`/`status` in any repo. It outlives the scaffold shell, and
# Start-Process -Wait waits for the whole process tree, so the runner hung
# forever on the first case. Force it off for every child via git's
# environment-config mechanism (no scaffold script needs to know), and wait
# only on the direct child process below, never the tree.
$env:GIT_CONFIG_COUNT   = '1'
$env:GIT_CONFIG_KEY_0   = 'core.fsmonitor'
$env:GIT_CONFIG_VALUE_0 = 'false'

# C:\Windows\System32\bash.exe is the WSL launcher stub, and it wins PATH
# resolution over Git's bash. It exits 0 doing nothing when WSL isn't
# installed, which silently produces an empty fixture. Find Git's explicitly.
$GitBash = @(
    (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
    (Join-Path $env:ProgramFiles 'Git\usr\bin\bash.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $GitBash) { throw "Git for Windows bash.exe not found - needed to run scaffold scripts" }

function ConvertTo-PosixPath([string]$WinPath) {
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') { return "/$($Matches[1].ToLower())$($Matches[2])" }
    return $p
}

# --- Minimal YAML reader for the subset these case files use -------------
# Handles: `key: value`, nested maps by 2-space indent, `[a, b]` flow lists,
# `|` / `>` block scalars, quoted strings. Not a YAML parser; enough for
# case.yaml and grader frontmatter, which are deliberately simple.
function Read-SimpleYaml([string[]]$Lines) {
    $root = @{}
    $stack = New-Object System.Collections.ArrayList
    [void]$stack.Add(@{ indent = -1; map = $root })
    $i = 0
    while ($i -lt $Lines.Count) {
        $line = $Lines[$i]
        if ($line -match '^\s*(#|$)') { $i++; continue }
        if ($line -notmatch '^(\s*)([A-Za-z_][\w-]*):\s*(.*)$') { $i++; continue }
        $indent = $Matches[1].Length; $key = $Matches[2]; $val = $Matches[3]
        while ($stack[$stack.Count - 1].indent -ge $indent) { $stack.RemoveAt($stack.Count - 1) }
        $parent = $stack[$stack.Count - 1].map

        if ($val -eq '' ) {
            $child = @{}
            $parent[$key] = $child
            [void]$stack.Add(@{ indent = $indent; map = $child })
            $i++; continue
        }
        if ($val -eq '|' -or $val -eq '>') {
            $block = @()
            $i++
            while ($i -lt $Lines.Count -and ($Lines[$i] -match '^\s*$' -or $Lines[$i] -match "^\s{$($indent + 1),}")) {
                $block += $Lines[$i]; $i++
            }
            $minIndent = ($block | Where-Object { $_ -match '\S' } | ForEach-Object { ($_ -match '^(\s*)') | Out-Null; $Matches[1].Length } | Measure-Object -Minimum).Minimum
            $text = ($block | ForEach-Object { if ($_.Length -ge $minIndent) { $_.Substring($minIndent) } else { '' } }) -join "`n"
            if ($val -eq '>') { $text = ($text -replace "(?<!\n)\n(?!\n)", ' ') }
            $parent[$key] = $text.TrimEnd()
            continue
        }
        if ($val -match '^\[(.*)\]$') {
            $parent[$key] = @($Matches[1] -split ',' | ForEach-Object { $_.Trim().Trim('"', "'") } | Where-Object { $_ })
            $i++; continue
        }
        if ($val -match '^\{(.*)\}$') {
            $m = @{}
            foreach ($pair in ($Matches[1] -split ',')) {
                if ($pair -match '^\s*([\w-]+)\s*:\s*(.*?)\s*$') { $m[$Matches[1]] = $Matches[2].Trim('"', "'") }
            }
            $parent[$key] = $m
            $i++; continue
        }
        if ($val -match "^'(.*)'$") { $parent[$key] = $Matches[1] }
        elseif ($val -match '^"(.*)"$') { $parent[$key] = $Matches[1] -replace '\\"', '"' }
        else { $parent[$key] = $val.Trim() }
        $i++
    }
    return $root
}

function Read-Frontmatter([string]$Path) {
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($text -notmatch '(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$') { throw "no frontmatter in $Path" }
    $fm = Read-SimpleYaml ($Matches[1] -split "\r?\n")
    $fm['_body'] = $Matches[2].Trim()
    return $fm
}

function ConvertFrom-Glob([string]$Glob) {
    $g = $Glob -replace '\\', '/'
    $re = [regex]::Escape($g) -replace '\\\*\\\*/', '(?:.*/)?' -replace '\\\*\\\*', '.*' -replace '\\\*', '[^/]*' -replace '\\\?', '.'
    return "^$re$"
}

function Get-RelativeFiles([string]$Dir) {
    Get-ChildItem -LiteralPath $Dir -Recurse -File -Force | ForEach-Object {
        ($_.FullName.Substring($Dir.Length).TrimStart('\', '/')) -replace '\\', '/'
    } | Where-Object { $_ -notlike '.git/*' }
}

function Invoke-Claude {
    param([string]$WorkDir, [string]$Prompt, [string[]]$AllowedTools, [int]$TimeoutSec, [string]$OutFile, [switch]$Judge)
    $promptFile = Join-Path $WorkDir '..\prompt.txt'
    [System.IO.File]::WriteAllText($promptFile, $Prompt, $Utf8NoBom)
    $errFile = "$OutFile.err"
    # NEVER pass --bare here. In this CLI build (2.1.274) a child started with
    # --bare reports "Not logged in - Please run /login" and returns a
    # zero-token synthetic error, even while `claude auth status` reports
    # loggedIn: true. It looks exactly like an expired session and it is not
    # one. Isolate the judge by withholding --plugin-dir instead.
    $args = @('-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence')
    if ($Judge) {
        $args += '--disable-slash-commands'
    } else {
        # --allowedTools alone is NOT enough in --print mode: a subagent's
        # Write came back denied while Edit succeeded, so cases silently
        # graded a component that had never been allowed to create a file.
        #
        # bypassPermissions is the only mode that actually works here, and it
        # was measured, not assumed - asking a child to create
        # .claude/sub/probe.json succeeded ONLY under bypassPermissions;
        # acceptEdits and dontAsk both left the file missing. Do not add
        # --permission-prompts none: that means "nobody answers", which
        # auto-DENIES rather than auto-allowing.
        #
        # The blast radius is bounded by construction: every run's cwd is a
        # throwaway fixture directory created under $env:TEMP for that run and
        # deleted after, never a real project, and the prompts come from case
        # files in this repo. Don't reuse this flag against a working tree.
        $args += @('--plugin-dir', $PluginRoot, '--setting-sources', 'local',
                   '--permission-mode', 'bypassPermissions')
        if ($AllowedTools -and $AllowedTools.Count -gt 0) { $args += @('--allowedTools') + $AllowedTools }
    }
    # Resolve claude.cmd explicitly. The npm install ships both claude.cmd and
    # claude.ps1; on a machine with the default execution policy the .ps1 shim
    # is refused ("not digitally signed"), so anything that resolves the bare
    # name can land on the blocked one.
    $claude = $script:ClaudeCmd
    if (-not $claude) {
        $claude = @(
            (Join-Path $env:APPDATA 'npm\claude.cmd'),
            (Get-Command claude.cmd -ErrorAction SilentlyContinue).Source
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        if (-not $claude) { throw "claude.cmd not found - is Claude Code installed via npm?" }
        $script:ClaudeCmd = $claude
    }
    $p = Start-Process -FilePath $claude -ArgumentList $args -WorkingDirectory $WorkDir `
        -RedirectStandardInput $promptFile -RedirectStandardOutput $OutFile -RedirectStandardError $errFile `
        -NoNewWindow -PassThru
    $null = $p.Handle
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        return @{ TimedOut = $true }
    }
    return @{ TimedOut = $false; ExitCode = $p.ExitCode }
}

function Read-Trace([string]$OutFile) {
    $toolUses = New-Object System.Collections.ArrayList
    $lastMessage = ''
    $cost = 0.0
    foreach ($line in (Get-Content -LiteralPath $OutFile -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        if (-not $line.Trim()) { continue }
        $obj = $null
        try { $obj = $line | ConvertFrom-Json } catch { continue }
        if ($obj.type -eq 'assistant' -and $obj.message -and $obj.message.content) {
            foreach ($block in $obj.message.content) {
                if ($block.type -eq 'tool_use') {
                    [void]$toolUses.Add(@{ name = $block.name; input = ($block.input | ConvertTo-Json -Compress -Depth 10) })
                }
                if ($block.type -eq 'text' -and $block.text) { $lastMessage = $block.text }
            }
        }
        if ($obj.type -eq 'result') {
            if ($obj.result) { $lastMessage = [string]$obj.result }
            if ($obj.total_cost_usd) { $cost = [double]$obj.total_cost_usd }
        }
    }
    return @{ ToolUses = $toolUses; LastMessage = $lastMessage; Cost = $cost }
}

function Get-GraderText($Grader, $Ctx) {
    $target = $Grader['target']
    if (-not $target) { $target = $Grader['focus'] }
    if (-not $target -or $target -eq 'last_message') { return $Ctx.Trace.LastMessage }
    if ($target -is [hashtable] -and $target['source'] -eq 'file') {
        $re = ConvertFrom-Glob $target['path']
        $parts = @()
        foreach ($rel in (Get-RelativeFiles $Ctx.WorkDir)) {
            if ($rel -match $re) { $parts += (Get-Content -LiteralPath (Join-Path $Ctx.WorkDir $rel) -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) }
        }
        return ($parts -join "`n")
    }
    if ($target -eq 'files') { return ($Ctx.Created -join "`n") }
    if ($target -eq 'trace') { return (($Ctx.Trace.ToolUses | ForEach-Object { "$($_.name) $($_.input)" }) -join "`n") }
    return $Ctx.Trace.LastMessage
}

function Test-Grader($Grader, $Ctx) {
    switch ($Grader['type']) {
        'regex' {
            $opts = [System.Text.RegularExpressions.RegexOptions]::None
            $flags = [string]$Grader['flags']
            if ($flags -like '*i*') { $opts = $opts -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase }
            if ($flags -like '*m*') { $opts = $opts -bor [System.Text.RegularExpressions.RegexOptions]::Multiline }
            if ($flags -like '*s*') { $opts = $opts -bor [System.Text.RegularExpressions.RegexOptions]::Singleline }
            $text = Get-GraderText $Grader $Ctx
            $count = ([regex]::Matches($text, [string]$Grader['pattern'], $opts)).Count
            $mode = [string]$Grader['match']
            if ($mode -eq 'not_contains') { return @{ Pass = ($count -eq 0); Detail = "matched $count time(s), expected 0" } }
            if ($mode -match '^count:(\d+)$') { return @{ Pass = ($count -eq [int]$Matches[1]); Detail = "matched $count time(s)" } }
            return @{ Pass = ($count -gt 0); Detail = "matched $count time(s)" }
        }
        'file_exists' {
            $re = ConvertFrom-Glob $Grader['path']
            $hits = @($Ctx.Created | Where-Object { $_ -match $re })
            $want = -not (([string]$Grader['exists']) -eq 'false')
            $has = $hits.Count -gt 0
            $detail = if ($has) { "created: " + ($hits -join ', ') } else { "no created file matches" }
            return @{ Pass = ($has -eq $want); Detail = $detail }
        }
        'tool_used' {
            $tool = [string]$Grader['tool']
            $im = [string]$Grader['input_match']
            $n = @($Ctx.Trace.ToolUses | Where-Object { $_.name -eq $tool -and (-not $im -or $_.input -match $im) }).Count
            $min = 1; $max = [int]::MaxValue
            if ($Grader.ContainsKey('min')) { $min = [int]$Grader['min'] }
            if ($Grader.ContainsKey('max')) { $max = [int]$Grader['max'] }
            return @{ Pass = ($n -ge $min -and $n -le $max); Detail = "$tool called $n time(s) (want $min..$(if ($max -eq [int]::MaxValue) { 'inf' } else { $max }))" }
        }
        'llm' {
            if ($SkipLlm) { return @{ Pass = $true; Detail = 'skipped (-SkipLlm)'; Skipped = $true } }
            $subject = Get-GraderText $Grader $Ctx
            $rubric = $Grader['_body']
            $judgePrompt = @"
You are grading one output from an automated agent against a rubric. Reply with exactly one word on the first line: PASS or FAIL. Then one sentence of reason.

RUBRIC:
$rubric

OUTPUT UNDER REVIEW:
<<<
$subject
>>>
"@
            # Judge runs in the run dir, not the fixture workspace, so the
            # plugin's own hooks have no PROGRESS.md to react to.
            $judgeOut = Join-Path $Ctx.RunDir 'judge.jsonl'
            $r = Invoke-Claude -WorkDir $Ctx.RunDir -Prompt $judgePrompt -TimeoutSec 180 -OutFile $judgeOut -Judge
            $jt = Read-Trace $judgeOut
            $Ctx.Cost += $jt.Cost
            $answer = [string]$jt.LastMessage

            # Fail closed on an ambiguous verdict. Reading only the first word
            # is not enough: a judge really did reply
            # "PASS: No wait, let me reconsider - actually FAIL." and the
            # first-word check scored that as a pass, which is the worst
            # possible failure mode for a grader - it masks a real regression
            # behind a green line. If the response contains both words as
            # standalone tokens, the judge did not decide, so neither do we.
            $saysPass = $answer -cmatch '\bPASS\b'
            $saysFail = $answer -cmatch '\bFAIL\b'
            $flat = ($answer -replace "\r?\n", ' ')
            if ($flat.Length -gt 160) { $flat = $flat.Substring(0, 160) + '...' }

            if ($saysPass -and $saysFail) {
                return @{ Pass = $false; Detail = "AMBIGUOUS judge verdict (said both PASS and FAIL) - treated as fail: $flat" }
            }
            if (-not $saysPass -and -not $saysFail) {
                return @{ Pass = $false; Detail = "NO judge verdict found - treated as fail: $flat" }
            }
            return @{ Pass = $saysPass; Detail = $flat }
        }
        default { return @{ Pass = $false; Detail = "unsupported grader type '$($Grader['type'])'" } }
    }
}

# --- Run -------------------------------------------------------------------
$caseDirs = Get-ChildItem -LiteralPath $EvalsDir -Directory | Where-Object {
    $_.Name -like $Case -and (Test-Path -LiteralPath (Join-Path $_.FullName 'case.yaml'))
}
if (-not $caseDirs) { Write-Host "no cases match '$Case'"; exit 1 }

$results = @()
$totalCost = 0.0
foreach ($cd in $caseDirs) {
    # Not `$case`: PowerShell variable names are case-insensitive, so that
    # would silently assign into the [string]-typed `$Case` parameter above
    # and coerce the parsed hashtable to the text "System.Collections.Hashtable".
    $caseDef = Read-SimpleYaml (Get-Content -LiteralPath (Join-Path $cd.FullName 'case.yaml') -Encoding UTF8)
    $exec = $caseDef['execution']; if (-not $exec) { $exec = @{} }
    $ctxCfg = $caseDef['context']; if (-not $ctxCfg) { $ctxCfg = @{} }
    $timeout = 300; if ($exec['timeout_seconds']) { $timeout = [int]$exec['timeout_seconds'] }
    $allowed = @(); if ($exec['allowed_tools']) { $allowed = @($exec['allowed_tools']) }

    Write-Host ""
    Write-Host "== $($cd.Name)" -ForegroundColor Cyan

    $runDir = Join-Path $env:TEMP ("devkit-eval-" + $cd.Name + "-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $workDir = Join-Path $runDir 'workspace'
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null

    if ($ctxCfg['scaffold_script']) {
        $script = Join-Path $cd.FullName $ctxCfg['scaffold_script']
        $cmd = "cd '$(ConvertTo-PosixPath $workDir)' && bash '$(ConvertTo-PosixPath $script)'"
        $sc = Start-Process -FilePath $GitBash -ArgumentList @('-c', "`"$cmd`"") -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $runDir 'scaffold.out') -RedirectStandardError (Join-Path $runDir 'scaffold.err')
        $null = $sc.Handle  # cache the handle or .ExitCode reads null after exit
        if (-not $sc.WaitForExit(120 * 1000)) { try { $sc.Kill() } catch {}; $sc = @{ ExitCode = 124 } }
        if ($sc.ExitCode -ne 0) {
            Write-Host "   scaffold failed (exit $($sc.ExitCode)):" -ForegroundColor Red
            Get-Content (Join-Path $runDir 'scaffold.err') | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
            $results += @{ Name = $cd.Name; Score = 0; Passed = 0; Total = 0; Cost = 0; Note = 'scaffold failed' }
            continue
        }
    }
    $before = @(Get-RelativeFiles $workDir)

    $traceFile = Join-Path $runDir 'trace.jsonl'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $run = Invoke-Claude -WorkDir $workDir -Prompt ([string]$exec['prompt']) -AllowedTools $allowed -TimeoutSec $timeout -OutFile $traceFile
    $sw.Stop()
    $trace = Read-Trace $traceFile
    $after = @(Get-RelativeFiles $workDir)
    $created = @($after | Where-Object { $before -notcontains $_ })

    $ctx = @{ WorkDir = $workDir; RunDir = $runDir; Trace = $trace; Created = $created; Cost = $trace.Cost }
    $note = ''
    if ($run.TimedOut) { $note = "timed out after ${timeout}s" }
    Write-Host ("   run: {0:n0}s, `${1:n3}, {2} tool call(s), {3} file(s) created{4}" -f $sw.Elapsed.TotalSeconds, $trace.Cost, $trace.ToolUses.Count, $created.Count, $(if ($note) { " - $note" } else { '' }))

    $graderFiles = Get-ChildItem -LiteralPath (Join-Path $cd.FullName 'graders') -Filter '*.md' -File | Sort-Object Name
    $passed = 0; $total = 0
    foreach ($gf in $graderFiles) {
        $g = Read-Frontmatter $gf.FullName
        $r = Test-Grader $g $ctx
        if (-not $r.Skipped) { $total++ }
        if ($r.Pass) { if (-not $r.Skipped) { $passed++ }; $mark = 'PASS'; $color = 'DarkGray' } else { $mark = 'FAIL'; $color = 'Red' }
        Write-Host ("   {0}  {1,-34} {2}" -f $mark, $gf.BaseName, $r.Detail) -ForegroundColor $color
    }
    $score = if ($total -gt 0) { [math]::Round($passed / $total, 2) } else { 0 }
    $totalCost += $ctx.Cost
    $results += @{ Name = $cd.Name; Score = $score; Passed = $passed; Total = $total; Cost = $ctx.Cost; Note = $note }

    if ($KeepTemp) { Write-Host "   kept: $runDir" -ForegroundColor DarkGray }
    else { Remove-Item -LiteralPath $runDir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ""
Write-Host ("{0,-32} {1,6} {2,8} {3,8}  {4}" -f 'CASE', 'SCORE', 'GRADERS', 'COST', 'NOTES')
$anyFail = $false
foreach ($r in $results) {
    if ($r.Score -lt 1) { $anyFail = $true }
    Write-Host ("{0,-32} {1,6:n2} {2,8} {3,8}  {4}" -f $r.Name, $r.Score, "$($r.Passed)/$($r.Total)", ('$' + [string]::Format('{0:n2}', $r.Cost)), $r.Note)
}
Write-Host ("{0} case(s) · total `${1:n2}" -f $results.Count, $totalCost)
if ($anyFail) { exit 1 } else { exit 0 }
