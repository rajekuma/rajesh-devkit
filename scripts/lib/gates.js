'use strict';

// Was this gate's verdict issued against the code that is here now?
//
// Why this exists. In the M28 run devkit-reviewer returned `ship`,
// devkit-security `clear` and devkit-quality `clean`. The orchestrator then
// applied two of quality's findings - an edit to a service method and a
// docstring - and carried on toward ship with all three verdicts still
// treated as current. They described a diff that no longer existed. Ship
// happened to catch it only because it re-runs the suite itself and happened
// to run after the edits; apply the same fix after ship and the milestone is
// marked done over code nothing verified.
//
// A verdict is therefore stamped with a fingerprint of the tree it was issued
// against, and read back as FRESH only when that fingerprint still matches.
// Everything else is STALE - including every case where freshness cannot be
// proven at all (not a git repository, git missing, a stamp with no
// fingerprint, a verdict for another milestone). That direction is the whole
// design: a mechanism that assumed freshness when it could not check would
// manufacture exactly the confidence this exists to remove. Over-staleness
// costs one re-run of a gate; under-staleness costs shipping unverified code.
//
// Why a fingerprint computed on demand rather than one a hook keeps. The
// PostToolUse hook only fires on Edit and Write; an edit made through Bash
// (sed, a formatter, a codegen step) never fires it, and a hook-maintained
// "last changed" time would miss it. Hashing the tree at the moment of the
// question has no such hole.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ensureGitignoreEntry, telemetryDir } = require('./devkit');

const GATES_FILE = 'gates.json';

// The stages whose output is a verdict about the finished diff. dep-audit is
// not a loop stage, but devkit-ship consumes its result exactly like the
// others, so it is stamped the same way. datamodel is deliberately absent: it
// produces a plan BEFORE implementation, so a stamp of it would always read
// stale by ship time and teach everyone to ignore STALE - and ship already
// checks that plan against the diff itself.
const GATES = ['ui-verify', 'review', 'quality', 'security', 'dep-audit', 'ship'];

// What an orchestrator is likely to type, mapped onto the stage name, so
// `record-gate devkit-reviewer ship` is not a usage error.
const ALIASES = { reviewer: 'review', audit: 'dep-audit' };

function normalizeGate(raw) {
  if (typeof raw !== 'string') return null;
  const bare = raw.trim().toLowerCase().replace(/^devkit-/, '');
  const name = ALIASES[bare] ?? bare;
  return GATES.includes(name) ? name : null;
}

function gatesPath(dir) {
  return path.join(telemetryDir(dir), GATES_FILE);
}

function git(dir, args, env) {
  try {
    const r = spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: env ? { ...process.env, ...env } : process.env,
    });
    if (r.error || r.status !== 0) return null;
    return (r.stdout ?? '').trim();
  } catch {
    return null;
  }
}

// A content hash of the working tree as it stands - committed, staged,
// unstaged and untracked alike, minus whatever .gitignore excludes (which is
// what keeps this plugin's own state files from changing it).
//
// Computed by staging everything into a THROWAWAY index and asking git for
// the tree it would commit. The real index is never touched, so a user's
// careful partial staging survives this being called. The throwaway starts
// as a copy of the real one only so git can reuse its stat cache instead of
// rehashing every file; if the copy fails it starts empty and is merely
// slower. The result is the same either way.
//
// Returns null whenever the question cannot be answered, and every caller
// reads null as "cannot prove fresh" - never as a match.
function treeFingerprint(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  // --path-format needs git 2.31; an older git prints the path relative to
  // the top level instead, which resolves to the same file.
  let realIndex = git(top, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (!realIndex) {
    const rel = git(top, ['rev-parse', '--git-path', 'index']);
    if (rel) realIndex = path.resolve(top, rel);
  }
  const tmp = path.join(
    os.tmpdir(),
    `devkit-gate-index-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  );
  try {
    if (realIndex) {
      try {
        fs.copyFileSync(realIndex, tmp);
      } catch {
        // No index yet (a repository with nothing ever staged) - start empty.
      }
    }
    const env = { GIT_INDEX_FILE: tmp };
    if (git(top, ['add', '-A', '--', '.'], env) === null) return null;
    const tree = git(top, ['write-tree'], env);
    return tree && /^[0-9a-f]{40,64}$/.test(tree) ? tree : null;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* a leftover temp index is litter, not a fault */
    }
  }
}

// Best-effort, like every other read of this plugin's state: missing or
// corrupt reads as "nothing recorded", which the check then reports as such -
// never as a pass.
function readGates(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(gatesPath(dir), 'utf8'));
    const gates = parsed && typeof parsed.gates === 'object' && parsed.gates !== null ? parsed.gates : {};
    const out = {};
    for (const [name, entry] of Object.entries(gates)) {
      if (GATES.includes(name) && entry && typeof entry === 'object') out[name] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

// Temp file plus rename, the same way lib/lease.js writes, so a reader never
// sees half a file - which it would read as "nothing recorded".
function writeGates(dir, gates) {
  const file = gatesPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, gates }, null, 2)}\n`, 'utf8');
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

// Stamp one gate's verdict with the tree it was issued against.
//
// The gitignore entry is ensured BEFORE fingerprinting, not after: on a
// project's very first record that line is what changes .gitignore, and
// fingerprinting first would stamp a tree that the act of recording then
// made stale.
function record(dir, { gate, verdict, milestone }, now = new Date()) {
  const name = normalizeGate(gate);
  if (!name) return { ok: false, error: `unknown gate '${gate}' - one of: ${GATES.join(', ')}` };
  const v = typeof verdict === 'string' ? verdict.trim().toLowerCase() : '';
  if (!v) return { ok: false, error: 'a verdict is required' };

  try {
    ensureGitignoreEntry(dir);
  } catch {
    // An unwritable .gitignore only means the fingerprint may include our
    // own state; that errs toward stale, which is the safe side.
  }
  const entry = {
    verdict: v,
    milestone: milestone ?? null,
    tree: treeFingerprint(dir),
    head: git(dir, ['rev-parse', 'HEAD']),
    recordedAt: now.toISOString(),
  };
  const gates = readGates(dir);
  gates[name] = entry;
  return { ok: writeGates(dir, gates), gate: name, entry };
}

// Every recorded verdict, judged against the tree and milestone as they are
// now. `current` is passed in by callers that already computed it.
function check(dir, { milestone = null, current } = {}) {
  const tree = current === undefined ? treeFingerprint(dir) : current;
  const recorded = readGates(dir);
  const results = [];
  for (const name of GATES) {
    const e = recorded[name];
    if (!e) continue;
    let reason = null;
    if ((e.milestone ?? null) !== (milestone ?? null)) reason = 'other-milestone';
    else if (!e.tree || !tree) reason = 'unprovable';
    else if (e.tree !== tree) reason = 'tree-changed';
    results.push({
      gate: name,
      verdict: typeof e.verdict === 'string' ? e.verdict : null,
      state: reason ? 'stale' : 'fresh',
      reason,
      recordedAt: typeof e.recordedAt === 'string' ? e.recordedAt : null,
      recordedMilestone: e.milestone ?? null,
    });
  }
  return { milestone, tree, results };
}

const REASON_TEXT = {
  'tree-changed': 'the tree has changed since this verdict was issued',
  unprovable: 'cannot prove which tree this verdict saw (no git fingerprint)',
  'other-milestone': 'recorded for a different milestone',
};

function describeReason(reason) {
  return REASON_TEXT[reason] ?? 'freshness unknown';
}

module.exports = {
  GATES,
  GATES_FILE,
  normalizeGate,
  gatesPath,
  treeFingerprint,
  readGates,
  record,
  check,
  describeReason,
};
