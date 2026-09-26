'use strict';

// Is THIS session driving the loop?
//
// Why this exists. The Stop hook used to drive every session in a project
// that had an unfinished milestone - including a session opened afterwards to
// do something else entirely. And every session claimed that milestone in
// session-lease.json just by existing: SessionStart claimed it, every edit
// renewed it, every stop renewed it. Found in real use after a milestone
// ended: a new session opened for unrelated work was told at every single
// turn that another session held the next milestone and asked which one owned
// it. The user had already answered "neither - I'm doing other work", and the
// hook, which cannot hear an answer, asked again at the next stop. The
// session's own summary suggested disabling the plugin's hook to make it
// stop, which is the opposite of what a loop plugin should teach.
//
// So a session drives the loop only after the user says so - `devkit
// continue` - and stops when told `devkit pause`. Only a driving session
// claims a milestone lease. `"loopStart": "always"` in .claude/devkit.json
// restores the old behaviour for a project that runs unattended on purpose.
//
// An arm is recorded against one milestone, not the session as a whole: when
// that milestone ships, the next one needs another `devkit continue`, which
// is the point at which a human reviews what shipped. `devkit continue all`
// arms the session for the whole queue instead, for a deliberately unattended
// run.

const fs = require('fs');
const path = require('path');
const { ensureGitignoreEntry, telemetryDir } = require('./devkit');

const ARM_FILE = 'loop-arm.json';
const ALL = '*';

// An arm left behind by a session that simply ended is harmless - no other
// session shares its id - but the file should not grow forever.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function armPath(dir) {
  return path.join(telemetryDir(dir), ARM_FILE);
}

// Best-effort, like every read of this plugin's state: missing or corrupt
// reads as "nobody armed", which leaves the loop idle - the quiet direction.
function readArms(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(armPath(dir), 'utf8'));
    const sessions = parsed && typeof parsed.sessions === 'object' && parsed.sessions !== null ? parsed.sessions : {};
    return sessions;
  } catch {
    return {};
  }
}

function writeArms(dir, sessions) {
  const file = armPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ensureGitignoreEntry(dir);
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`, 'utf8');
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

function pruned(sessions, now) {
  const out = {};
  for (const [id, entry] of Object.entries(sessions)) {
    const at = entry && Date.parse(entry.armedAt);
    if (Number.isFinite(at) && now - at < MAX_AGE_MS) out[id] = entry;
  }
  return out;
}

// `scope` is the lane this session works in, when it has one - { phase } or
// { milestone }; see lib/devkit.js findNextMilestone. It is what lets two
// sessions run in parallel on different phases (usually in different git
// worktrees, one on Claude and one on a gateway profile) without both
// reaching for the first unfinished row in the tracker.
function arm(dir, sessionId, milestone, scope = null, now = Date.now()) {
  if (!sessionId) return false;
  const sessions = pruned(readArms(dir), now);
  sessions[sessionId] = {
    milestone: milestone ?? ALL,
    ...(scope ? { scope } : {}),
    armedAt: new Date(now).toISOString(),
  };
  return writeArms(dir, sessions);
}

// The lane this session was started in, or null for the whole tracker.
function scopeOf(dir, sessionId) {
  if (!sessionId) return null;
  const entry = readArms(dir)[sessionId];
  const s = entry && entry.scope;
  if (s && (typeof s.phase === 'string' || typeof s.milestone === 'string')) return s;
  return null;
}

function disarm(dir, sessionId, now = Date.now()) {
  if (!sessionId) return false;
  const sessions = pruned(readArms(dir), now);
  delete sessions[sessionId];
  return writeArms(dir, sessions);
}

// Whether the hooks should drive, and claim, this milestone for this session.
//
// With no session id the answer is the old behaviour. Every harness event
// carries one (verified for the lease work), so this only ever applies to a
// hook run by hand - devkit-eval, a debugging session, the regression suite -
// where there is no session to have said anything.
//
// `milestone` is the milestone object from findNextMilestone (a bare display
// string is still accepted). A phase-scoped session drives every milestone
// in its phase and nothing outside it.
function isDriving(dir, config, sessionId, milestone) {
  if (config && config.loopStart === 'always') return true;
  if (!sessionId) return true;
  const entry = readArms(dir)[sessionId];
  if (!entry) return false;
  const display = typeof milestone === 'string' ? milestone : milestone && milestone.display;
  const phase = typeof milestone === 'object' && milestone ? milestone.phase : null;
  if (entry.scope && typeof entry.scope.phase === 'string') {
    return phase != null && String(phase).toLowerCase() === entry.scope.phase.toLowerCase();
  }
  return entry.milestone === ALL || entry.milestone === display;
}

// The keywords, matched only at the very start of a prompt, so a sentence
// that merely mentions them ("why did devkit stop?") never arms or pauses
// anything. A leading slash is tolerated because people type one out of habit.
//
//   devkit continue             the next milestone in the tracker
//   devkit continue all         the whole queue, unattended
//   devkit continue phase 9     every milestone in Phase 9, then stop - a lane
//   devkit continue M46         that one milestone, even if it isn't first
//
// Anything else after "continue" is ignored, as it always was, so a stray
// word never turns a plain continue into something narrower by accident.
const CONTINUE_RE = /^\s*\/?devkit[\s-]+(?:continue|resume|start)\b(.*)$/i;
const PAUSE_RE = /^\s*\/?devkit[\s-]+(?:pause|stop)\b/i;

function parseCommand(prompt) {
  if (typeof prompt !== 'string') return null;
  const c = prompt.split(/\r?\n/)[0].match(CONTINUE_RE);
  if (c) {
    const rest = c[1].trim().replace(/[.!]+$/, '');
    if (/^all$/i.test(rest)) return { action: 'continue', all: true };
    const phase = rest.match(/^phase\s+([\w.]+)$/i);
    if (phase) return { action: 'continue', all: false, scope: { phase: phase[1] } };
    const one = rest.match(/^(?:milestone\s+)?(m?\d[\w.]*)$/i);
    if (one) return { action: 'continue', all: false, scope: { milestone: one[1].replace(/^m/i, '') } };
    return { action: 'continue', all: false };
  }
  if (PAUSE_RE.test(prompt)) return { action: 'pause' };
  return null;
}

module.exports = { ARM_FILE, ALL, armPath, readArms, arm, disarm, scopeOf, isDriving, parseCommand };
