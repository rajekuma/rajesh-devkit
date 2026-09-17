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
// 2026-06-24 per the claude-api skill). Cache write = 1.25x input at the
// 5-minute TTL, 2x at the 1-hour TTL; cache read = 0.1x input - except
// claude-fable-5-1, which has a documented flat $0.25/MTok cache-read rate
// (0.025x), not the general convention. Update this table if pricing
// changes; it is not fetched live.
const PRICING = {
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1 },
  'claude-fable-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25 },
};

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

let totalCost = 0;
const byModel = [];
for (const [model, r] of results) {
  // Match the bare model ID first; a subagent's recorded model can carry a
  // dated-snapshot suffix (e.g. "claude-haiku-4-5-20251001") that an exact
  // match against this table's bare keys would miss - found for real: 1.9M
  // haiku tokens silently fell into unknownModelTokens before this existed.
  let p = PRICING[model];
  if (!p) {
    const stripped = model.replace(/-\d{8}$/, '');
    if (stripped !== model) p = PRICING[stripped];
  }

  let modelCost = null;
  if (p) {
    modelCost =
      (r.input / 1e6) * p.input +
      (r.output / 1e6) * p.output +
      (r.cacheWrite5m / 1e6) * (p.input * 1.25) +
      (r.cacheWrite1h / 1e6) * (p.input * 2) +
      (r.cacheRead / 1e6) * p.cacheRead;
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
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      totalCostUsd: round(totalCost, 4),
      unknownModelTokens,
      byModel,
      byAgent: byAgentList,
    },
    null,
    2
  )}\n`
);
