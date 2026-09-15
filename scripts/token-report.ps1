[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectDir,
    [Parameter(Mandatory = $true)][string]$StartTime,
    [Parameter(Mandatory = $true)][string]$EndTime
)

# Deterministic token/cost scanner for a time window, used by devkit-stats.
# Not a hook - invoked directly (via Bash) when a report is requested, since
# summing usage across potentially many transcript lines is a job for
# actual arithmetic, not for an LLM reading a multi-megabyte file turn by
# turn.
#
# Pricing ($ per million tokens). Source: Anthropic API pricing (cached
# 2026-06-24 per the claude-api skill). Cache write = 1.25x input price at
# the 5-minute TTL, 2x at the 1-hour TTL; cache read = 0.1x input price -
# except claude-fable-5-1, which has a documented flat $0.25/MTok cache-read
# rate (0.025x), not the general 0.1x convention. Update this table if
# pricing changes; it is not fetched live.
$Pricing = @{
    'claude-opus-5'    = @{ input = 5.00;  output = 25.00; cacheRead = 0.50 }
    'claude-sonnet-5'  = @{ input = 2.00;  output = 10.00; cacheRead = 0.20 }
    'claude-haiku-4-5' = @{ input = 1.00;  output = 5.00;  cacheRead = 0.10 }
    'claude-fable-5-1' = @{ input = 10.00; output = 50.00; cacheRead = 0.25 }
}

$start = ([datetime]$StartTime).ToUniversalTime()
$end = ([datetime]$EndTime).ToUniversalTime()

# Matches Claude Code's own project-directory sanitization: every one of
# : \ / . and space becomes a literal hyphen; everything else is untouched.
# Verified empirically against real transcript folder names, including a
# nested worktree path with a leading dot.
$sanitized = $ProjectDir -replace '[:\\/. ]', '-'
$transcriptDir = Join-Path $env:USERPROFILE ".claude\projects\$sanitized"

$results = @{}
$byAgent = @{}
$unknownModelTokens = 0

function Add-Usage {
    param($Model, $Usage, $AgentId, $AgentMeta)

    if (-not $results.ContainsKey($Model)) {
        $results[$Model] = @{ input = 0; output = 0; cacheWrite5m = 0; cacheWrite1h = 0; cacheRead = 0 }
    }
    $r = $results[$Model]
    $r.input += [int64]$Usage.input_tokens
    $r.output += [int64]$Usage.output_tokens
    if ($Usage.cache_creation) {
        $r.cacheWrite5m += [int64]$Usage.cache_creation.ephemeral_5m_input_tokens
        $r.cacheWrite1h += [int64]$Usage.cache_creation.ephemeral_1h_input_tokens
    } elseif ($Usage.cache_creation_input_tokens) {
        # Older/simpler entries with no tier breakdown: assume 5-minute TTL (the default).
        $r.cacheWrite5m += [int64]$Usage.cache_creation_input_tokens
    }
    $r.cacheRead += [int64]$Usage.cache_read_input_tokens

    if ($AgentId) {
        if (-not $byAgent.ContainsKey($AgentId)) {
            $byAgent[$AgentId] = @{
                agentType   = if ($AgentMeta) { $AgentMeta.agentType } else { $null }
                description = if ($AgentMeta) { $AgentMeta.description } else { $null }
                model       = $Model
                tokens      = 0
            }
        }
        $total = [int64]$Usage.input_tokens + [int64]$Usage.output_tokens +
                 [int64]$Usage.cache_creation_input_tokens + [int64]$Usage.cache_read_input_tokens
        $byAgent[$AgentId].tokens += $total
    }
}

function Scan-Transcript {
    param($Path, $AgentId, $AgentMeta)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if (-not $line) { continue }
        $entry = $null
        try { $entry = $line | ConvertFrom-Json } catch { continue }
        if ($entry.type -ne 'assistant') { continue }
        if (-not $entry.timestamp) { continue }
        $ts = $null
        try { $ts = ([datetime]$entry.timestamp).ToUniversalTime() } catch { continue }
        if ($ts -lt $start -or $ts -gt $end) { continue }
        $usage = $entry.message.usage
        if (-not $usage) { continue }
        Add-Usage -Model $entry.message.model -Usage $usage -AgentId $AgentId -AgentMeta $AgentMeta
    }
}

if (Test-Path -LiteralPath $transcriptDir) {
    Get-ChildItem -LiteralPath $transcriptDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue | ForEach-Object {
        Scan-Transcript -Path $_.FullName -AgentId $null -AgentMeta $null
    }
    Get-ChildItem -LiteralPath $transcriptDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $subDir = Join-Path $_.FullName 'subagents'
        if (Test-Path -LiteralPath $subDir) {
            Get-ChildItem -LiteralPath $subDir -Filter 'agent-*.jsonl' -File -ErrorAction SilentlyContinue | ForEach-Object {
                $agentId = $_.BaseName -replace '^agent-', ''
                $metaPath = Join-Path $subDir "agent-$agentId.meta.json"
                $agentMeta = $null
                if (Test-Path -LiteralPath $metaPath) {
                    try { $agentMeta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json } catch {}
                }
                Scan-Transcript -Path $_.FullName -AgentId $agentId -AgentMeta $agentMeta
            }
        }
    }
}

$totalCost = 0.0
$byModel = @()
foreach ($model in $results.Keys) {
    $r = $results[$model]
    # Match the bare model ID first; a subagent's recorded model can carry a
    # dated-snapshot suffix (e.g. "claude-haiku-4-5-20251001") that an exact
    # match against this table's bare keys ("claude-haiku-4-5") would miss -
    # found for real: 1.9M real haiku tokens silently fell into
    # unknownModelTokens before this fallback existed.
    $p = $Pricing[$model]
    if (-not $p) {
        $stripped = $model -replace '-\d{8}$', ''
        if ($stripped -ne $model) { $p = $Pricing[$stripped] }
    }
    $modelCost = $null
    if ($p) {
        $modelCost = ($r.input / 1000000 * $p.input) +
                     ($r.output / 1000000 * $p.output) +
                     ($r.cacheWrite5m / 1000000 * ($p.input * 1.25)) +
                     ($r.cacheWrite1h / 1000000 * ($p.input * 2)) +
                     ($r.cacheRead / 1000000 * $p.cacheRead)
        $totalCost += $modelCost
    } else {
        $unknownModelTokens += ($r.input + $r.output + $r.cacheWrite5m + $r.cacheWrite1h + $r.cacheRead)
    }
    $byModel += [PSCustomObject]@{
        model              = $model
        inputTokens        = $r.input
        outputTokens       = $r.output
        cacheWrite5mTokens = $r.cacheWrite5m
        cacheWrite1hTokens = $r.cacheWrite1h
        cacheReadTokens    = $r.cacheRead
        costUsd            = if ($null -ne $modelCost) { [math]::Round($modelCost, 4) } else { $null }
    }
}

$byAgentList = @()
foreach ($id in $byAgent.Keys) {
    $byAgentList += [PSCustomObject]@{
        agentId     = $id
        agentType   = $byAgent[$id].agentType
        description = $byAgent[$id].description
        model       = $byAgent[$id].model
        tokens      = $byAgent[$id].tokens
    }
}

[PSCustomObject]@{
    totalCostUsd        = [math]::Round($totalCost, 4)
    unknownModelTokens  = $unknownModelTokens
    byModel             = $byModel
    byAgent             = $byAgentList
} | ConvertTo-Json -Depth 6
