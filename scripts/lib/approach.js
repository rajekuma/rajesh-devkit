'use strict';

// How the user chose to build a milestone: "self" (the orchestrating session
// implements it directly) or "delegate" (devkit-implementer does). Asked once,
// by the sensitive-milestone gate in continue-loop.
//
// It has to be remembered, and on disk, because the answer outlives the turn
// it was given in. Found in real use (M35a/M35b): the user chose "implement it
// myself", and every later nudge for the same milestone still said "invoke
// devkit-implementer ... do not do its work yourself" - the loop contradicted
// the human's decision the moment the session stopped once. The gate's own
// "shown once" memory lives in OS temp and does not survive a resume on
// another machine; this file lives with the project's other loop state.
//
// Keyed by milestone number (M35a -> "35a"), not the display name: a
// milestone renamed mid-flight kept its number and lost everything keyed by
// its title.

const fs = require('fs');
const path = require('path');
const { ensureGitignoreEntry, telemetryDir } = require('./devkit');

const APPROACH_FILE = 'approach.json';
const APPROACHES = ['self', 'delegate'];

function approachPath(dir) {
  return path.join(telemetryDir(dir), APPROACH_FILE);
}

function keyOf(milestone) {
  const m = /^\s*M?([0-9]+[A-Za-z]?)\b/.exec(String(milestone ?? ''));
  return m ? m[1].toLowerCase() : null;
}

// Best-effort: missing or corrupt reads as "not chosen", and an unchosen
// milestone gets the standard delegation instruction - today's behaviour.
function readApproaches(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(approachPath(dir), 'utf8'));
    return parsed && typeof parsed.milestones === 'object' && parsed.milestones !== null ? parsed.milestones : {};
  } catch {
    return {};
  }
}

function approachFor(dir, milestone) {
  const key = keyOf(milestone);
  if (!key) return null;
  const entry = readApproaches(dir)[key];
  return entry && APPROACHES.includes(entry.approach) ? entry.approach : null;
}

function recordApproach(dir, milestone, approach) {
  if (!APPROACHES.includes(approach)) {
    return { ok: false, error: `approach must be one of: ${APPROACHES.join(', ')}` };
  }
  const key = keyOf(milestone);
  if (!key) return { ok: false, error: 'no current milestone to record an approach for' };
  const milestones = readApproaches(dir);
  milestones[key] = { approach, milestone, recordedAt: new Date().toISOString() };
  const file = approachPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ensureGitignoreEntry(dir);
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, milestones }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, key, approach };
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to clean */
    }
    return { ok: false, error: 'could not write the approach record' };
  }
}

module.exports = { APPROACH_FILE, APPROACHES, approachPath, keyOf, readApproaches, approachFor, recordApproach };
