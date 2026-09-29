#!/usr/bin/env node
'use strict';

// Deterministic token/cost scanner for a time window, used by devkit-stats.
// Not a hook - invoked directly when a report is requested, since summing
// usage across potentially many megabytes of transcript is a job for
// arithmetic, not for an LLM reading a file turn by turn.
//
//   node token-report.js --project-dir <path> --start-time <iso> --end-time <iso>
//
// The PowerShell-style flags (-ProjectDir/-StartTime/-EndTime) are accepted
// too, so an older devkit-stats invocation keeps working.
//
// Emits JSON on stdout: totalCostUsd, unknownModelTokens, byModel, byAgent.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Pricing ($ per million tokens). Source: Anthropic API pricing (cached
// 2026-09-25 per the claude-api skill). Opus 5.5 and Sonnet 5.5 were missing
// until 0.11.2, so every turn they ran fell into unknownModelTokens and a
// milestone built on Opus 5.5 reported $0.00. Cache write = 1.25x input at the
// 5-minute TTL, 2x at the 1-hour TTL; cache read = 0.1x input - except
// claude-fable-5-1, which has a documented flat $0.25/MTok cache-read rate
// (0.025x), not the general convention. Update this table if pricing
// changes; it is not fetched live.
const PRICING = {
  'claude-opus-5-5': { input: 4.0, output: 20.0, cacheRead: 0.2 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2.0, output: 10.0, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1 },
  'claude-fable-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25 },
};

// A project can price models this table has never heard of - anything served
// through a gateway - by adding a `prices` map to .claude/devkit.json:
//
//   "prices": { "qwen/qwen3-coder": { "input": 0.3, "output": 1.0 } }
//
// Same units ($ per million tokens). cacheRead defaults to a tenth of input,
// the general convention, since most gateways do not publish one separately.
//
// This exists because the moment a milestone runs on a gateway, every token
// it spent fell into unknownModelTokens and the cost line read $0.00 - and a
// report that says a run was free is worse than one that admits it does not
// know what the run cost. `node profiles/check.js` prints current list prices
// to copy from.
function readConfiguredPrices(projectDir) {
  for (const rel of [
    ['.claude', 'rajesh-devkit', 'devkit.local.json'],
    ['.claude', 'devkit.json'],
  ]) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, ...rel), 'utf8'));
      if (!cfg || !cfg.prices || typeof cfg.prices !== 'object') continue;
      const out = {};
      for (const [model, p] of Object.entries(cfg.prices)) {
        const input = Number(p && p.input);
        const output = Number(p && p.output);
        // A half-specified price would produce a confidently wrong number,
        // which is the one outcome worse than "unknown". Skip it.
        if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
        const cacheRead = Number.isFinite(Number(p.cacheRead)) ? Number(p.cacheRead) : input * 0.1;
        out[model] = { input, output, cacheRead };
      }
      return out;
    } catch {
      // Absent or malformed: try the next file, then fall back to none.
    }
  }
  return {};
}

function parseArgs(argv) {
  const out = {};
  const alias = {
    'project-dir': 'projectDir',
    projectdir: 'projectDir',
    'start-time': 'startTime',
    starttime: 'startTime',
    'end-time': 'endTime',
    endtime: 'endTime',
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('-')) continue;
    const key = raw.replace(/^-+/, '').toLowerCase();
    const mapped = alias[key];
    if (mapped && i + 1 < argv.length) {
      out[mapped] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ['projectDir', 'startTime', 'endTime']) {
  if (!args[required]) {
    process.stderr.write(
      'token-report: --project-dir, --start-time and --end-time are all required\n'
    );
    process.exit(1);
  }
}

const start = new Date(args.startTime).getTime();
const end = new Date(args.endTime).getTime();
if (Number.isNaN(start) || Number.isNaN(end)) {
  process.stderr.write('token-report: --start-time / --end-time must be parseable dates\n');
  process.exit(1);
}

// Matches Claude Code's own project-directory sanitization: every one of
// : \ / . and space becomes a literal hyphen; everything else is untouched.
// Verified empirically against real transcript folder names, including a
// nested worktree path with a leading dot.
const sanitized = args.projectDir.replace(/[:\\/. ]/g, '-');
const transcriptDir = path.join(os.homedir(), '.claude', 'projects', sanitized);

const results = new Map();
const byAgent = new Map();
// The same per-model usage, split by who spent it: every subagent run, and
// the main session under a null agentId. Without the main session's own row
// a milestone the orchestrator implemented directly shows as a total with
// nothing accounting for most of it - found on M35a, where the main session
// was ~80% of the spend and the report listed only the five gate agents.
const usageByAgent = new Map();
// Every assistant turn's timestamp in the window, for active time: wall-clock
// from start to ship includes nights and meetings, which is useless for
// estimating the next milestone.
const turnTimes = [];
let unknownModelTokens = 0;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function addUsage(model, usage, agentId, agentMeta) {
  if (!results.has(model)) {
    results.set(model, { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
  }
  const r = results.get(model);
  r.input += num(usage.input_tokens);
  r.output += num(usage.output_tokens);
  if (usage.cache_creation) {
    r.cacheWrite5m += num(usage.cache_creation.ephemeral_5m_input_tokens);
    r.cacheWrite1h += num(usage.cache_creation.ephemeral_1h_input_tokens);
  } else if (usage.cache_creation_input_tokens) {
    // Older/simpler entries with no tier breakdown: assume the 5-minute
    // default TTL rather than dropping the tokens.
    r.cacheWrite5m += num(usage.cache_creation_input_tokens);
  }
  r.cacheRead += num(usage.cache_read_input_tokens);

  const agentKey = agentId ?? null;
  if (!usageByAgent.has(agentKey)) usageByAgent.set(agentKey, new Map());
  const perModel = usageByAgent.get(agentKey);
  if (!perModel.has(model)) {
    perModel.set(model, { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
  }
  const a = perModel.get(model);
  a.input += num(usage.input_tokens);
  a.output += num(usage.output_tokens);
  if (usage.cache_creation) {
    a.cacheWrite5m += num(usage.cache_creation.ephemeral_5m_input_tokens);
    a.cacheWrite1h += num(usage.cache_creation.ephemeral_1h_input_tokens);
  } else if (usage.cache_creation_input_tokens) {
    a.cacheWrite5m += num(usage.cache_creation_input_tokens);
  }
  a.cacheRead += num(usage.cache_read_input_tokens);

  if (agentId) {
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, {
        agentType: agentMeta ? (agentMeta.agentType ?? null) : null,
        description: agentMeta ? (agentMeta.description ?? null) : null,
        model,
        tokens: 0,
      });
    }
    byAgent.get(agentId).tokens +=
      num(usage.input_tokens) +
      num(usage.output_tokens) +
      num(usage.cache_creation_input_tokens) +
      num(usage.cache_read_input_tokens);
  }
}

function scanTranscript(file, agentId, agentMeta) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || !entry.timestamp) continue;
    const ts = new Date(entry.timestamp).getTime();
    if (Number.isNaN(ts) || ts < start || ts > end) continue;
    turnTimes.push(ts);
    const usage = entry.message && entry.message.usage;
    if (!usage) continue;
    addUsage(entry.message.model, usage, agentId, agentMeta);
  }
}

function listDir(dir, filter) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(filter)
      .map((e) => ({ name: e.name, full: path.join(dir, e.name) }));
  } catch {
    return [];
  }
}

if (fs.existsSync(transcriptDir)) {
  for (const f of listDir(transcriptDir, (e) => e.isFile() && e.name.endsWith('.jsonl'))) {
    scanTranscript(f.full, null, null);
  }
  for (const sub of listDir(transcriptDir, (e) => e.isDirectory())) {
    const subDir = path.join(sub.full, 'subagents');
    if (!fs.existsSync(subDir)) continue;
    const agentFiles = listDir(
      subDir,
      (e) => e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')
    );
    for (const f of agentFiles) {
      const agentId = f.name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
      const metaPath = path.join(subDir, `agent-${agentId}.meta.json`);
      let agentMeta = null;
      try {
        agentMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        agentMeta = null;
      }
      scanTranscript(f.full, agentId, agentMeta);
    }
  }
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

const CONFIGURED_PRICES = readConfiguredPrices(args.projectDir);

function priceOf(model) {
  let p = PRICING[model] ?? CONFIGURED_PRICES[model];
  if (!p) {
    const stripped = String(model).replace(/-\d{8}$/, '');
    if (stripped !== model) p = PRICING[stripped] ?? CONFIGURED_PRICES[stripped];
  }
  return p ?? null;
}

function costOf(model, r) {
  const p = priceOf(model);
  if (!p) return null;
  return (
    (r.input / 1e6) * p.input +
    (r.output / 1e6) * p.output +
    (r.cacheWrite5m / 1e6) * (p.input * 1.25) +
    (r.cacheWrite1h / 1e6) * (p.input * 2) +
    (r.cacheRead / 1e6) * p.cacheRead
  );
}

// Cost of one agent's usage across the models it ran; null when any of its
// tokens came from a model with no price, rather than a partial sum that
// reads as the whole.
function agentCost(perModel) {
  let sum = 0;
  for (const [model, r] of perModel) {
    const c = costOf(model, r);
    if (c === null) return null;
    sum += c;
  }
  return sum;
}

function agentTokens(perModel) {
  let t = 0;
  for (const r of perModel.values()) t += r.input + r.output + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;
  return t;
}

// Active minutes: the sum of gaps between consecutive assistant turns, each
// gap counted only up to IDLE_CAP_MS. A pause longer than that is someone
// away - a night, a meeting, an unanswered question - not work.
const IDLE_CAP_MS = 15 * 60 * 1000;
function activeMinutes(times) {
  const t = [...times].sort((x, y) => x - y);
  let ms = 0;
  for (let i = 1; i < t.length; i++) ms += Math.min(t[i] - t[i - 1], IDLE_CAP_MS);
  return Math.round(ms / 60000);
}

let totalCost = 0;
const byModel = [];
for (const [model, r] of results) {
  // Match the bare model ID first; a subagent's recorded model can carry a
  // dated-snapshot suffix (e.g. "claude-haiku-4-5-20251001") that an exact
  // match against this table's bare keys would miss - found for real: 1.9M
  // haiku tokens silently fell into unknownModelTokens before this existed.
  // (priceOf strips that suffix.)
  const modelCost = costOf(model, r);
  if (modelCost !== null) {
    totalCost += modelCost;
  } else {
    unknownModelTokens += r.input + r.output + r.cacheWrite5m + r.cacheWrite1h + r.cacheRead;
  }

  byModel.push({
    model,
    inputTokens: r.input,
    outputTokens: r.output,
    cacheWrite5mTokens: r.cacheWrite5m,
    cacheWrite1hTokens: r.cacheWrite1h,
    cacheReadTokens: r.cacheRead,
    costUsd: modelCost === null ? null : round(modelCost, 4),
  });
}

const byAgentList = [];
for (const [agentId, a] of byAgent) {
  byAgentList.push({
    agentId,
    agentType: a.agentType,
    description: a.description,
    model: a.model,
    tokens: a.tokens,
    costUsd: usageByAgent.has(agentId) ? nullableRound(agentCost(usageByAgent.get(agentId))) : null,
  });
}

const mainUsage = usageByAgent.get(null);
const mainSession = mainUsage
  ? { tokens: agentTokens(mainUsage), costUsd: nullableRound(agentCost(mainUsage)), models: [...mainUsage.keys()] }
  : { tokens: 0, costUsd: 0, models: [] };

function nullableRound(v) {
  return v === null ? null : round(v, 4);
}

process.stdout.write(
  `${JSON.stringify(
    {
      totalCostUsd: round(totalCost, 4),
      unknownModelTokens,
      activeMinutes: activeMinutes(turnTimes),
      assistantTurns: turnTimes.length,
      mainSession,
      byModel,
      byAgent: byAgentList,
    },
    null,
    2
  )}\n`
);
