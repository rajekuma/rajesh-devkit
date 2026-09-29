#!/usr/bin/env node
'use strict';

// Per-milestone cost and effort records, kept IN the project's repository so
// they are there the next time someone asks "how long will Phase 9 take, and
// what will it cost?".
//
//   node milestone-metrics.js record [M<n>] [--start <iso>] [--end <iso>]
//                                    [--commit <sha>] [--note "<why>"]
//   node milestone-metrics.js summary
//
// `record` measures one milestone and writes it to <metricsDir>/milestones.jsonl
// (one JSON line per milestone, replaced if it is recorded again), then
// regenerates <metricsDir>/README.md. With no milestone it takes the one
// resume.json names. With no --start/--end the window comes from the
// telemetry this plugin already writes: the earliest milestone_started for
// that number to the first milestone_shipped after it. Passing either marks
// the record "estimated" - a backfill from commit times or a transcript is
// useful, and must never read as a measurement.
//
// The raw telemetry lives in .claude/rajesh-devkit/, gitignored, per machine.
// These records are the part worth keeping: small, reviewed, committed.
//
// Exit codes: 0 recorded (or metrics switched off), 1 could not record - a
// missing window, an unreadable tracker. Never throws.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const gates = require('./lib/gates');
const approach = require('./lib/approach');

const DEFAULT_DIR = path.join('docs', 'metrics');
const JSONL = 'milestones.jsonl';
const README = 'README.md';

function fail(message) {
  process.stderr.write(`milestone-metrics: ${message}\n`);
  process.exit(1);
}

function resolveProjectDir() {
  const fromEnv = d.projectDir();
  if (fromEnv) return fromEnv;
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (!r.error && r.status === 0 && (r.stdout ?? '').trim()) return r.stdout.trim();
  return process.cwd();
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && i + 1 < argv.length) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function readTelemetry(dir) {
  const text = d.readFileOrNull(path.join(d.telemetryDir(dir), 'telemetry.jsonl'));
  if (!text) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.event === 'string' && typeof e.milestone === 'string') out.push(e);
    } catch {
      /* one bad line loses one event, not the report */
    }
  }
  return out;
}

// Grouped by number, not name: a milestone renamed in flight, or re-armed in
// a new session, logs starts under more than one name (found on M35a).
function telemetryWindow(events, key) {
  const mine = events.filter((e) => approach.keyOf(e.milestone) === key);
  const starts = mine.filter((e) => e.event === 'milestone_started').map((e) => e.timestamp).sort();
  if (starts.length === 0) return null;
  const ships = mine
    .filter((e) => e.event === 'milestone_shipped' && e.timestamp >= starts[0])
    .map((e) => e.timestamp)
    .sort();
  if (ships.length === 0) return null;
  return { start: starts[0], end: ships[0] };
}

function tokenReport(dir, start, end) {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, 'token-report.js'), '--project-dir', dir, '--start-time', start, '--end-time', end],
    { encoding: 'utf8', timeout: 60000 }
  );
  if (r.error || r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function git(dir, args, env) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  return r.error || r.status !== 0 ? null : (r.stdout ?? '').trim();
}

function parseShortstat(text) {
  if (text == null) return null;
  const n = (re) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : 0;
  };
  return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?/), deletions: n(/(\d+) deletions?/) };
}

// The size of the change, which is what makes cost comparable across
// milestones. A named commit when backfilling; otherwise the working tree
// against HEAD - untracked files included, through a throwaway index, since a
// milestone's new files are most of it - because the loop marks a milestone
// done before anyone commits it.
function diffStat(dir, commit) {
  if (commit) {
    const s = parseShortstat(git(dir, ['show', '--shortstat', '--format=', commit]));
    return s ? { ...s, source: `commit ${commit}` } : null;
  }
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  const tmp = path.join(os.tmpdir(), `devkit-metrics-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const realIndex = git(top, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    try {
      if (realIndex) fs.copyFileSync(realIndex, tmp);
    } catch {
      /* no index yet - start empty */
    }
    const env = { GIT_INDEX_FILE: tmp };
    if (git(top, ['add', '-A', '--', '.'], env) === null) return null;
    const s = parseShortstat(git(top, ['diff', '--cached', '--shortstat', 'HEAD'], env));
    return s ? { ...s, source: 'working tree vs HEAD at ship' } : null;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* litter, not a fault */
    }
  }
}

function round(v, places = 2) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function hoursBetween(a, b) {
  return round((new Date(b).getTime() - new Date(a).getTime()) / 3600000);
}

function metricsPaths(dir, config) {
  const rel = config.metricsDir || DEFAULT_DIR;
  const base = path.isAbsolute(rel) ? rel : path.join(dir, rel);
  return { base, jsonl: path.join(base, JSONL), readme: path.join(base, README) };
}

function readRecords(file) {
  const text = d.readFileOrNull(file);
  if (!text) return [];
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a hand-edited bad line is dropped from the summary, kept in git history */
    }
  }
  return out;
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// The summary a person reads before estimating the next milestone
// ---------------------------------------------------------------------------

function money(v) {
  return v == null ? 'unknown' : `$${v.toFixed(2)}`;
}

function perCriterion(v, criteria, unit) {
  if (v == null || !criteria) return '-';
  return unit === '$' ? `$${(v / criteria).toFixed(2)}` : `${Math.round(v / criteria)}`;
}

function summarize(records) {
  const sorted = [...records].sort((a, b) => String(a.window.start).localeCompare(String(b.window.start)));
  const lines = [
    '# Milestone metrics',
    '',
    '<!-- Generated by rajesh-devkit (scripts/milestone-metrics.js) from',
    'milestones.jsonl in this folder. Edit that file, not this one; the next',
    'record regenerates this page. -->',
    '',
    'What each milestone actually took: active time, cost in API-price dollars,',
    'and how big the change was, so the next estimate starts from measurements.',
    '',
    '- **Active** counts time between assistant turns, capping any single pause at',
    '  15 minutes, so nights and unanswered questions are not counted as work.',
    '  **Wall** is the whole window, start to ship.',
    '- **Cost** is list API price for every token in the window: the main session',
    '  and every subagent. On a subscription it is what the same work would cost',
    '  on the API, which is still the right number to compare milestones by.',
    '- **Built by** is the model that spent most in the main session, and whether',
    '  it implemented directly (`self`) or delegated to devkit-implementer.',
    '- **Source**: `measured` windows come from the loop\'s own telemetry;',
    '  `estimated` ones were reconstructed afterwards (see each record\'s note).',
    '',
    '## Milestones',
    '',
    '| Milestone | Phase | Built by | Active h | Wall h | Cost | Implementing / gates | Criteria | $ per criterion | Active min per criterion | Lines +/- | Source |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of sorted) {
    const built = `${r.primaryModel ?? 'unknown'}${r.approach ? ` (${r.approach})` : ''}`;
    const split = `${money(r.mainSession && r.mainSession.costUsd)} / ${money(r.subagentCostUsd)}`;
    const diff = r.diff ? `+${r.diff.insertions} / -${r.diff.deletions}` : '-';
    lines.push(
      `| ${r.milestone} | ${r.phase ?? '-'} | ${built} | ${r.activeHours} | ${r.wallClockHours} | ${money(r.costUsd)} | ${split} | ${r.criteria ?? '-'} | ${perCriterion(r.costUsd, r.criteria, '$')} | ${perCriterion(r.activeHours * 60, r.criteria, 'min')} | ${diff} | ${r.window.source} |`
    );
  }

  // Averages per building model: the basis for "what would Sonnet take for
  // this phase?". Per criterion, because milestones differ in size by 10x and
  // a per-milestone average hides that.
  const byModel = new Map();
  for (const r of sorted) {
    const key = r.primaryModel ?? 'unknown';
    if (!byModel.has(key)) byModel.set(key, { n: 0, criteria: 0, cost: 0, costKnown: true, active: 0 });
    const m = byModel.get(key);
    m.n += 1;
    m.criteria += r.criteria || 0;
    if (r.costUsd == null) m.costKnown = false;
    else m.cost += r.costUsd;
    m.active += r.activeHours;
  }
  lines.push('', '## By building model', '');
  lines.push('| Model | Milestones | Criteria | Total cost | Total active h | $ per criterion | Active min per criterion |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [model, m] of byModel) {
    lines.push(
      `| ${model} | ${m.n} | ${m.criteria} | ${m.costKnown ? money(m.cost) : 'unknown'} | ${round(m.active)} | ${m.costKnown ? perCriterion(m.cost, m.criteria, '$') : '-'} | ${perCriterion(m.active * 60, m.criteria, 'min')} |`
    );
  }

  const byPhase = new Map();
  for (const r of sorted) {
    const key = r.phase ?? '-';
    if (!byPhase.has(key)) byPhase.set(key, { n: 0, cost: 0, costKnown: true, active: 0, wall: 0 });
    const p = byPhase.get(key);
    p.n += 1;
    if (r.costUsd == null) p.costKnown = false;
    else p.cost += r.costUsd;
    p.active += r.activeHours;
    p.wall += r.wallClockHours;
  }
  lines.push('', '## By phase', '');
  lines.push('| Phase | Milestones recorded | Total cost | Total active h | Total wall h |');
  lines.push('|---|---|---|---|---|');
  for (const [phase, p] of byPhase) {
    lines.push(`| ${phase} | ${p.n} | ${p.costKnown ? money(p.cost) : 'unknown'} | ${round(p.active)} | ${round(p.wall)} |`);
  }
  lines.push(
    '',
    'A few milestones make a rough guide, not a forecast: note the model, the',
    'criteria count and whether the milestone was sensitive before reusing a rate.',
    ''
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command !== 'record' && command !== 'summary') {
  fail('usage: node milestone-metrics.js record [M<n>] [--start <iso>] [--end <iso>] [--commit <sha>] [--note "<why>"]\n' +
    '       node milestone-metrics.js summary');
}

const dir = resolveProjectDir();
const config = d.readStageConfig(dir);
if (config.metrics === false) {
  process.stdout.write('milestone-metrics: switched off ("metrics": false) - nothing recorded\n');
  process.exit(0);
}
const paths = metricsPaths(dir, config);

if (command === 'summary') {
  const records = readRecords(paths.jsonl);
  if (records.length === 0) fail(`no records yet in ${paths.jsonl}`);
  try {
    writeAtomic(paths.readme, `${summarize(records)}`);
  } catch {
    fail(`could not write ${paths.readme}`);
  }
  process.stdout.write(`milestone-metrics: ${paths.readme} regenerated from ${records.length} record(s)\n`);
  process.exit(0);
}

// record
const progressPath = path.join(dir, 'PROGRESS.md');
let key = args._[1] ? approach.keyOf(args._[1]) : null;
if (!key) {
  try {
    const resume = JSON.parse(fs.readFileSync(path.join(d.telemetryDir(dir), 'resume.json'), 'utf8'));
    key = approach.keyOf(resume && resume.milestone);
  } catch {
    key = null;
  }
}
if (!key) fail('name the milestone: node milestone-metrics.js record M<n>');

const row = d.findMilestoneByNumber(progressPath, key);
const display = row ? row.display : `M${key}`;

const measured = telemetryWindow(readTelemetry(dir), key);
const start = args.start ?? (measured && measured.start);
const end = args.end ?? (measured && measured.end);
if (!start || !end) {
  fail(
    `no telemetry window for M${key} (no start, or no ship after it). Pass --start and ` +
      '--end to record an estimate from another source, with --note saying which.'
  );
}
if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime()) || start > end) {
  fail('--start and --end must be ISO dates, start before end');
}
const estimated = Boolean(args.start || args.end);

const report = tokenReport(dir, start, end);
if (!report) fail('the transcript scan failed (scripts/token-report.js)');

const mainCost = report.mainSession ? report.mainSession.costUsd : null;
const subCosts = (report.byAgent || []).map((a) => a.costUsd);
const subagentCostUsd = subCosts.some((c) => c == null) ? null : round(subCosts.reduce((s, c) => s + c, 0), 4);

// The model that did the building: whichever the main session spent most on.
let primaryModel = null;
if (report.mainSession && report.mainSession.models && report.mainSession.models.length > 0) {
  const rank = (report.byModel || []).filter((m) => report.mainSession.models.includes(m.model));
  rank.sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  primaryModel = rank.length > 0 ? rank[0].model.replace(/-\d{8}$/, '') : report.mainSession.models[0];
}

const spec = row ? d.findSpecForMilestone(dir, row.number, row.name) : null;
const criteria = d.countCriteria(spec);
const recordedGates = {};
for (const [name, e] of Object.entries(gates.readGates(dir))) {
  if (approach.keyOf(e.milestone) === key) recordedGates[name] = e.verdict;
}

const tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
for (const m of report.byModel || []) {
  tokens.input += m.inputTokens;
  tokens.output += m.outputTokens;
  tokens.cacheWrite += m.cacheWrite5mTokens + m.cacheWrite1hTokens;
  tokens.cacheRead += m.cacheReadTokens;
}

const record = {
  milestone: `M${key}`,
  name: row ? row.name : null,
  phase: row ? row.phase : null,
  window: {
    start,
    end,
    source: estimated ? 'estimated' : 'measured',
    note: args.note ?? (estimated ? null : 'loop telemetry: first start to first ship'),
  },
  wallClockHours: hoursBetween(start, end),
  activeHours: round((report.activeMinutes ?? 0) / 60),
  assistantTurns: report.assistantTurns ?? null,
  costUsd: report.unknownModelTokens > 0 ? null : report.totalCostUsd,
  unknownModelTokens: report.unknownModelTokens,
  tokens,
  primaryModel,
  approach: approach.approachFor(dir, display) ?? (args.approach || null),
  sensitive: spec ? d.isSensitiveSpec(spec, config) : null,
  criteria: criteria ? criteria.total : null,
  mainSession: report.mainSession
    ? { costUsd: report.mainSession.costUsd, models: report.mainSession.models }
    : null,
  subagentCostUsd,
  subagents: (report.byAgent || []).map((a) => ({
    type: a.agentType,
    model: a.model ? a.model.replace(/-\d{8}$/, '') : null,
    costUsd: a.costUsd,
  })),
  gates: recordedGates,
  diff: diffStat(dir, args.commit),
  recordedAt: new Date().toISOString(),
  pluginVersion: pluginVersion(),
};
if (mainCost == null && report.mainSession && report.mainSession.tokens > 0) record.mainSession.costUsd = null;

const records = readRecords(paths.jsonl).filter((r) => r && r.milestone !== record.milestone);
records.push(record);
records.sort((a, b) => String(a.window.start).localeCompare(String(b.window.start)));
try {
  writeAtomic(paths.jsonl, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  writeAtomic(paths.readme, summarize(records));
} catch {
  fail(`could not write ${paths.base}`);
}
process.stdout.write(
  `milestone-metrics: ${record.milestone} ${record.window.source} - ${record.activeHours} active h, ` +
    `${money(record.costUsd)}, built by ${record.primaryModel ?? 'unknown'} -> ${path.relative(dir, paths.jsonl)}\n`
);
process.exit(0);
