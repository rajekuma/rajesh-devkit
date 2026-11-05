'use strict';

// Can a person actually do the thing yet?
//
// Why this exists. Every gate in this loop judges one milestone's diff, and they
// were all doing their job while the project they were guarding could not be used.
// Dogfooding (2026-11-05): 29 tracker mentions of "API-side", a core feature's API
// finished in September with its screen unstarted, every recorded verdict a pass,
// and fixes landing for faults between the parts. Nothing added the milestones up.
//
// A journey is one outcome a named person can achieve, and its check is a command
// that exercises the real thing and can fail. See docs/plans/journeys.md.
//
// Three rules hold it up:
//   - The plugin records the result of a run it performed. There is deliberately
//     no way to stamp a pass, unlike record-gate.js, because the point is that a
//     model cannot talk its way past this. A manual journey is accepted only by
//     the user's own words, read by the prompt hook.
//   - Hooks never run a check. It is an arbitrary command that can take minutes.
//   - Freshness fails safe: a result for another tree or a changed check is stale,
//     and so is any result whose tree cannot be proved (PRINCIPLES 3).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const d = require('./devkit');
const gates = require('./gates');

const JOURNEYS_FILE = 'JOURNEYS.md';
const PROOF_FILE = 'journeys.json';
const MANUAL = 'manual';
// After this many failed runs on one milestone the plan is the likelier fault,
// and a loop cannot see the plan. A person has to look.
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_S = 600;
const MAX_TIMEOUT_S = 7200;

const HEADING = /^##\s+(J\d[\w.-]*)(?:\s+(.*?))?\s*$/;
const ANY_HEADING = /^#{1,2}\s/;
const FIELD = /^(For|Outcome|Needs|Check|Timeout):\s*(.*?)\s*$/i;
const REQUIRED = ['for', 'outcome', 'check'];

function journeysPath(dir) {
  return path.join(dir, JOURNEYS_FILE);
}

// The file is the opt-in: a project without one behaves exactly as it did.
function active(dir, config) {
  if (config && config.journeys === false) return false;
  try {
    return fs.statSync(journeysPath(dir)).isFile();
  } catch {
    return false;
  }
}

// "28", "m28" and "M28" all name the tracker's M28.
function needKey(raw) {
  const m = String(raw).trim().match(/^m?(\d[\w.]*)$/i);
  return m ? `M${m[1]}` : String(raw).trim();
}

function parse(text) {
  const out = [];
  let current = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const heading = line.match(HEADING);
    if (heading) {
      current = { id: heading[1], title: heading[2] || heading[1], fields: {} };
      out.push(current);
      continue;
    }
    if (ANY_HEADING.test(line)) {
      current = null;
      continue;
    }
    const field = current && line.match(FIELD);
    if (field) current.fields[field[1].toLowerCase()] = field[2];
  }

  const seen = {};
  for (const j of out) seen[j.id] = (seen[j.id] || 0) + 1;

  return out.map((j) => {
    const missingFields = REQUIRED.filter((f) => !j.fields[f]);
    const check = (j.fields.check || '').replace(/^`(.*)`$/, '$1').trim();
    const timeout = Number(j.fields.timeout);
    const invalid =
      seen[j.id] > 1
        ? `id ${j.id} is used more than once`
        : missingFields.length > 0
          ? `missing ${missingFields.join(', ')}`
          : null;
    return {
      id: j.id,
      title: j.title,
      for: j.fields.for || null,
      outcome: j.fields.outcome || null,
      needs: (j.fields.needs || '').split(',').map(needKey).filter(Boolean),
      check,
      manual: check.toLowerCase() === MANUAL,
      timeoutS:
        Number.isFinite(timeout) && timeout >= 1 ? Math.min(Math.floor(timeout), MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S,
      invalid,
    };
  });
}

function readJourneys(dir) {
  return parse(d.readFileOrNull(journeysPath(dir)));
}

function hashCheck(check) {
  return crypto.createHash('sha256').update(String(check), 'utf8').digest('hex');
}

// The tracker, this file and the metrics record change when a milestone is closed.
// Counting them would make a proof stale the moment its own row was ticked.
function fingerprint(dir, config) {
  const metrics = (config && config.metricsDir) || path.join('docs', 'metrics');
  return gates.treeFingerprint(dir, { exclude: ['PROGRESS.md', JOURNEYS_FILE, metrics] });
}

// Run before fingerprinting anything a proof will be stamped with. Found in a live
// run: the first proof added .claude/rajesh-devkit/ to .gitignore, which changed the
// tree, so a manual journey accepted seconds earlier read as stale.
function prepare(dir) {
  try {
    d.ensureGitignoreEntry(dir);
  } catch {
    // Unwritable: the proof reads stale rather than wrong.
  }
}

function proofPath(dir) {
  return path.join(d.telemetryDir(dir), PROOF_FILE);
}

function emptyState() {
  return { version: 1, proofs: {}, attempts: {} };
}

// Missing or corrupt reads as "nothing has been run", so nothing is claimed.
function readState(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(proofPath(dir), 'utf8'));
    const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
    return {
      version: 1,
      proofs: isMap(parsed.proofs) ? parsed.proofs : {},
      attempts: isMap(parsed.attempts) ? parsed.attempts : {},
    };
  } catch {
    return emptyState();
  }
}

function writeState(dir, state) {
  const file = proofPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    d.ensureGitignoreEntry(dir);
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to clean */
    }
    return false;
  }
}

// Stores no output and no command text: a check can print secrets.
function recordProof(dir, journey, { result, exitCode = null, durationMs = null, tree }, now = new Date()) {
  const state = readState(dir);
  state.proofs[journey.id] = {
    result,
    exitCode,
    durationMs,
    at: now.toISOString(),
    tree: tree ?? null,
    checkHash: hashCheck(journey.check),
  };
  return writeState(dir, state);
}

function attemptsFor(dir, key) {
  const n = readState(dir).attempts[needKey(key)];
  return Number.isFinite(n) ? n : 0;
}

function setAttempts(dir, key, n) {
  const state = readState(dir);
  const k = needKey(key);
  if (n > 0) state.attempts[k] = n;
  else if (k in state.attempts) delete state.attempts[k];
  else return true;
  return writeState(dir, state);
}

function trackerRows(dir) {
  const rows = d.readMilestoneStatuses(path.join(dir, 'PROGRESS.md'));
  const out = {};
  for (const [key, row] of Object.entries(rows)) out[key.toLowerCase()] = row;
  return out;
}

function stateOf(journey, proof, tree, outstanding) {
  if (journey.invalid) return 'invalid';
  if (proof) {
    if (proof.checkHash !== hashCheck(journey.check)) return 'stale';
    if (!proof.tree || !tree || proof.tree !== tree) return 'stale';
    if (proof.result === 'pass') return 'proven';
    if (proof.result === 'accepted') return 'accepted';
    if (proof.result === 'fail') return 'failing';
    if (proof.result === 'unknown') return 'unknown';
    return 'stale';
  }
  return outstanding > 0 ? 'blocked' : 'ready';
}

const isProven = (j) => j.state === 'proven' || j.state === 'accepted';

// Fewest milestones away. Ties go to file order: the project wrote it in that order.
function closestOf(list) {
  let best = null;
  for (const j of list) {
    if (j.state === 'invalid' || isProven(j)) continue;
    const away = j.unfinished.length + j.missing.length;
    if (!best || away < best.away) best = { ...j, away };
  }
  return best;
}

function evaluate(dir, config, { tree } = {}) {
  const current = tree === undefined ? fingerprint(dir, config) : tree;
  const rows = trackerRows(dir);
  const { proofs } = readState(dir);
  const journeys = readJourneys(dir).map((j) => {
    const unfinished = [];
    const missing = [];
    for (const need of j.needs) {
      const row = rows[need.toLowerCase()];
      if (!row) missing.push(need);
      else if (!row.done) unfinished.push(need);
    }
    const proof = proofs[j.id] && typeof proofs[j.id] === 'object' ? proofs[j.id] : null;
    return {
      ...j,
      unfinished,
      missing,
      state: stateOf(j, proof, current, unfinished.length + missing.length),
      lastRunAt: proof && typeof proof.at === 'string' ? proof.at : null,
    };
  });
  return { journeys, closest: closestOf(journeys), tree: current };
}

function namesMilestone(journey, key) {
  const want = needKey(key).toLowerCase();
  return journey.needs.some((n) => n.toLowerCase() === want);
}

function linkedTo(dir, key) {
  return readJourneys(dir).filter((j) => !j.invalid && namesMilestone(j, key));
}

function counts(list) {
  const valid = list.filter((j) => j.state !== 'invalid');
  return {
    total: valid.length,
    proven: valid.filter(isProven).length,
    accepted: valid.filter((j) => j.state === 'accepted').length,
    stale: valid.filter((j) => j.state === 'stale').length,
    failing: valid.filter((j) => j.state === 'failing').length,
    unknown: valid.filter((j) => j.state === 'unknown').length,
    invalid: list.length - valid.length,
  };
}

function countsLine(list) {
  const c = counts(list);
  const parts = [`${c.proven} of ${c.total} proven${c.accepted ? ` (${c.accepted} accepted by hand)` : ''}`];
  for (const k of ['stale', 'failing', 'unknown', 'invalid']) {
    if (c[k] > 0) parts.push(`${c[k]} ${k}`);
  }
  return parts.join(', ');
}

function closestLine(closest) {
  if (!closest) return null;
  const outstanding = [...closest.unfinished, ...closest.missing];
  let what;
  if (outstanding.length > 0) what = `needs ${outstanding.join(', ')}`;
  else if (closest.manual) what = `needs you to try it, then say "devkit journey ${closest.id} passed"`;
  else what = 'needs its check to pass';
  return `Closest: ${closest.id} ${closest.title}, which ${what}.`;
}

function report(evaluation) {
  const { journeys, closest } = evaluation;
  if (journeys.length === 0) return `DevKit journeys: ${JOURNEYS_FILE} defines none yet.`;
  const lines = [`DevKit journeys: ${countsLine(journeys)}`, ''];
  for (const j of journeys) {
    const notes = [];
    if (j.invalid) notes.push(j.invalid);
    if (j.unfinished.length > 0 && !j.invalid) notes.push(`needs ${j.unfinished.join(', ')}`);
    if (j.missing.length > 0 && !j.invalid) notes.push(`not in the tracker: ${j.missing.join(', ')}`);
    if (isProven(j) && j.unfinished.length > 0) notes.push('the tracker looks out of date');
    if (j.lastRunAt && !j.invalid) notes.push(`last run ${j.lastRunAt.slice(0, 16).replace('T', ' ')} UTC`);
    lines.push(`  ${j.id.padEnd(5)} ${j.state.padEnd(9)} ${j.title}${notes.length ? ` | ${notes.join(' | ')}` : ''}`);
  }
  if (evaluation.tree === null) {
    lines.push('', 'This tree cannot be fingerprinted, so no result can be proved current.');
  }
  const close = closestLine(closest);
  if (close) lines.push('', close);
  return lines.join('\n');
}

// One line for the start-up banner. Never throws: a banner must always appear.
function bannerLine(dir, config) {
  try {
    if (!active(dir, config)) return null;
    const e = evaluate(dir, config);
    if (e.journeys.length === 0) return null;
    const close = closestLine(e.closest);
    return `Journeys: ${countsLine(e.journeys)}.${close ? ` ${close}` : ''} Say "devkit journeys" for all of them.`;
  } catch {
    return null;
  }
}

// For the end-of-turn line, which cannot afford a tree fingerprint on every turn.
// It therefore can't say a result is current, only what the last run found.
function lastRunSummary(dir, config) {
  try {
    if (!active(dir, config)) return null;
    const { proofs } = readState(dir);
    const valid = readJourneys(dir).filter((j) => !j.invalid);
    if (valid.length === 0) return null;
    const passed = valid.filter((j) => {
      const p = proofs[j.id];
      return p && (p.result === 'pass' || p.result === 'accepted') && p.checkHash === hashCheck(j.check);
    }).length;
    return `journeys ${passed}/${valid.length} passed at last run`;
  } catch {
    return null;
  }
}

// Shown when `devkit continue` takes a milestone no journey needs. It informs and
// never redirects: what to build next is the user's call (PRINCIPLES 4).
function continueNotice(dir, config, milestone) {
  try {
    if (!active(dir, config) || !milestone) return null;
    if (milestone.number != null && linkedTo(dir, `M${milestone.number}`).length > 0) return null;
    const { closest } = evaluate(dir, config);
    if (!closest) return null;
    const next = closest.unfinished[0];
    const hint = next ? ` To work on that instead, say "devkit continue ${next}".` : '';
    return `DevKit | ${milestone.display} moves no journey. ${closestLine(closest)}${hint}`;
  } catch {
    return null;
  }
}

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

// English only, so a translated shell message falls through to `failing`: still
// not a pass, which is the direction that matters.
const NOT_FOUND = /is not recognized as an internal or external command|command not found|: not found\s*$/im;

// Output streams through to the caller and is held in memory only long enough to
// see whether the command even started. It is never written anywhere.
function runCheck(dir, journey, now = () => Date.now()) {
  return new Promise((resolve) => {
    const started = now();
    let timedOut = false;
    let tail = '';
    let done = false;
    const finish = (result, exitCode) => {
      if (done) return;
      done = true;
      resolve({ result, exitCode, durationMs: now() - started, timedOut });
    };
    let child;
    try {
      child = spawn(journey.check, {
        cwd: dir,
        shell: true,
        stdio: ['ignore', 'inherit', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch {
      finish('unknown', null);
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, journey.timeoutS * 1000);
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      tail = `${tail}${chunk}`.slice(-4096);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish('unknown', null);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || signal) finish('unknown', code);
      else if (code === 0) finish('pass', 0);
      else if (code === 126 || code === 127 || code === 9009 || NOT_FOUND.test(tail)) finish('unknown', code);
      else finish('fail', code);
    });
  });
}

module.exports = {
  JOURNEYS_FILE,
  PROOF_FILE,
  MANUAL,
  MAX_ATTEMPTS,
  active,
  needKey,
  parse,
  readJourneys,
  fingerprint,
  prepare,
  readState,
  recordProof,
  attemptsFor,
  setAttempts,
  evaluate,
  namesMilestone,
  linkedTo,
  isProven,
  report,
  bannerLine,
  lastRunSummary,
  continueNotice,
  runCheck,
};
