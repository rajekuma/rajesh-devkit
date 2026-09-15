[CmdletBinding()]
param()

# PostToolUse hook (matched on Edit|Write): if the host project provides its
# own .claude\verify.ps1, run it and pass its exit code straight through so
# the harness's own exit-code semantics for this event apply (2 = surface the
# failure to Claude). Otherwise exit 0 silently - this hook is a no-op unless
# the host project opts in by providing the script.

[Console]::In.ReadToEnd() | Out-Null

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir) {
    exit 0
}

$verifyScript = Join-Path $projectDir '.claude\verify.ps1'
if (-not (Test-Path -LiteralPath $verifyScript)) {
    exit 0
}

& $verifyScript
exit $LASTEXITCODE
