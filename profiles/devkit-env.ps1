# Switches which provider the NEXT `claude` launch talks to.
#
#   . <plugin>\profiles\devkit-env.ps1      # once per shell
#   Use-DevkitProfile openrouter            # then launch: claude
#   Use-DevkitProfile claude                # back to the subscription
#
# WHY THIS IS A SHELL FUNCTION AND NOT PART OF THE LOOP
#
# The provider is fixed when the CLI process starts. Nothing inside a running
# session can change it - not a hook, not a skill, not a subagent - because
# they are all children of a process whose credentials and base URL were
# already resolved. So switching providers is always: set the environment,
# then start a NEW session. There is no mid-session switch to build.
#
# WHAT THIS MEANS FOR A LIMIT
#
# When a usage window runs out, the session stops mid-whatever-it-was-doing
# and cannot be restarted on another provider in place. That is fine, because
# the loop's position is on disk, not in the session: see
# .claude/rajesh-devkit/resume.json, which the PostToolUse hook rewrites after
# every edit. Open a new shell, run one of these, start `claude`, and the
# session-start banner tells you which milestone and which criterion to
# continue from.
#
# Do NOT use `claude --continue` across a provider switch. Resuming replays
# the whole transcript to the new provider as fresh input tokens - there is no
# prompt cache across providers - so it costs the most exactly when you
# switched to spend less, and it hands a cheaper model your longest context.
# A fresh session plus the resume file is both cheaper and more reliable.

function Use-DevkitProfile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('claude', 'openrouter')]
        [string]$Name
    )

    # Every variable this function ever sets, cleared first, so switching
    # profiles is a replacement and not an accumulation. A leftover
    # ANTHROPIC_DEFAULT_SONNET_MODEL from a previous profile is the kind of
    # bug you find three milestones later.
    $vars = @(
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_FABLE_MODEL'
    )
    foreach ($v in $vars) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }

    if ($Name -eq 'claude') {
        Write-Host "devkit profile: claude - subscription credential, Anthropic models."
        Write-Host "Start a new `claude` session for this to take effect."
        return
    }

    if (-not $env:OPENROUTER_API_KEY) {
        Write-Error @"
OPENROUTER_API_KEY is not set, so this profile would launch unauthenticated.

Set it for this shell only:
    `$env:OPENROUTER_API_KEY = '<your key>'

Or keep it in a file this function will not read and you will not commit,
e.g. `$env:USERPROFILE\.devkit\secrets.ps1 containing that same line, and dot-
source it from your PowerShell profile. Nothing here writes a key to disk.
"@
        return
    }

    $profilePath = Join-Path $PSScriptRoot 'openrouter.json'
    $cfg = Get-Content $profilePath -Raw | ConvertFrom-Json

    # Base URL is deliberately the bare /api. Claude Code appends /v1/messages
    # itself, so a base URL ending in /v1 produces /v1/v1/messages and a 404
    # that looks like an auth problem.
    $env:ANTHROPIC_BASE_URL = $cfg.baseUrl

    # The credential goes in AUTH_TOKEN, and API_KEY is explicitly blanked:
    # a stray ANTHROPIC_API_KEY from some earlier experiment otherwise wins
    # and the gateway rejects it.
    $env:ANTHROPIC_AUTH_TOKEN = $env:OPENROUTER_API_KEY
    $env:ANTHROPIC_API_KEY = ''

    # The four tier aliases every component here asks for by name.
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL = $cfg.tiers.opus
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL = $cfg.tiers.sonnet
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $cfg.tiers.haiku
    $env:ANTHROPIC_DEFAULT_FABLE_MODEL = $cfg.tiers.fable

    Write-Host "devkit profile: openrouter"
    Write-Host "  opus   -> $($cfg.tiers.opus)"
    Write-Host "  sonnet -> $($cfg.tiers.sonnet)"
    Write-Host "  haiku  -> $($cfg.tiers.haiku)"
    Write-Host ""
    Write-Host "This session bills per token to your OpenRouter credit, NOT to your"
    Write-Host "Claude subscription. Set a hard spend cap in the OpenRouter dashboard."
    Write-Host "Start a new `claude` session for this to take effect."
}
