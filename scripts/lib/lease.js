'use strict';

// Is another session already working this milestone in this working tree?
//
// Why this exists. Every other piece of state this plugin keeps - PROGRESS.md's
// `## In flight` block, the spec's ticked criteria, resume.json, git status -
// answers "where did the work get to". None of them answers "is somebody
// holding it right now", and the hooks were reading the first question as an
// answer to the second. On 2026-09-22 a SessionStart greeted a new session with
// "picking up M28, mid-flight - resume at criterion 4" while another session,
// started nine minutes earlier in the same tree, was already implementing M28.
// It wrote the service, the endpoints and a 44-test suite in that window,
// including the exact two registration lines the newly-greeted session had
// independently diagnosed as missing and was about to write itself. Nothing
// caught it; the second session happened to re-list a directory and notice a
// 25KB file that had not been there minutes earlier.
//
// What it is NOT. Not a lock - nothing here blocks a session from working.
// Not an arbiter - it never decides which session should stand down. It
// publishes presence and reports a collision with its evidence, and a human
// decides. That is deliberate: two sessions in one tree is sometimes exactly
// what the user intended (a second window reading while the first builds), and
// a mechanism that guesses wrong in that case costs more than the collision.
//
// Why not process enumeration. `Get-Process claude` is Windows-only, and the
// hooks are Node precisely so they work on macOS and Linux (see hooks.json).
// Worse, it cannot tell which repository a process belongs to: three claude
// processes on a machine say nothing about whether any of them is in THIS
// tree. It is evidence for a human, never a mechanism.
//
// Why not a pid. A hook is a child process - its own pid is meaningless, and
// its parent may be a shell rather than the session. Pids are also reused.
// The harness hands every hook a `session_id` (verified against a live
// harness on SessionStart, Stop and PostToolUse), which is stable for the
// life of a session, unique across them, and survives the session moving
// between machines in a way a pid cannot. That is the key.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// Only for the ignore rule. devkit.js knows nothing about leases, so this
// direction never becomes a cycle - and routing it through the one function
// that owns that rule is what keeps the lease file's ignore story identical to
// resume.json's, rather than a second copy that drifts. Constraint 6.
const { ensureGitignoreEntry } = require('./devkit');

const LEASE_FILE = 'session-lease.json';

// How long a lease survives without a fresh sign of life. Long enough that a
// session thinking hard, running a slow suite, or waiting on the user is never
// declared dead mid-flight; short enough that a session killed by a usage
// limit does not lock the next one out of its own milestone for an afternoon.
// The incident window was nine minutes, so anything under that would have
// missed it.
const DEFAULT_TTL_MINUTES = 15;

// A TTL from config is user input in a hook that must never misbehave: 0 would
// disable detection silently, and 10000 would make a crashed session's lease
// effectively permanent - the exact lockout constraint 3 exists to prevent.
const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 240;

function ttlMs(config) {
  const raw = config && config.sessionLeaseTtlMinutes;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_TTL_MINUTES;
  return Math.min(Math.max(n, MIN_TTL_MINUTES), MAX_TTL_MINUTES) * 60 * 1000;
}

function leasePath(dir) {
  return path.join(dir, '.claude', 'rajesh-devkit', LEASE_FILE);
}

// Two paths naming the same tree must compare equal, or every session looks
// foreign to every other and detection never fires. Windows is the reason:
// C:\Dev\Proj and c:/dev/proj are the same directory, and the harness, git and
// Node each have their own preference. realpath also collapses a symlinked
// checkout onto its target.
function normalizePath(p) {
  let out = p;
  try {
    out = fs.realpathSync(out);
  } catch {
    // A path that cannot be resolved is still worth comparing as written.
  }
  out = out.split(path.sep).join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

// Which working tree this is - the git worktree root, not the repository.
//
// This is what makes constraint 4's "a different worktree is not a conflict"
// true by construction rather than by accident: `--show-toplevel` in a linked
// worktree returns that worktree's own root, so two sessions on two worktrees
// of one repository never match each other, even though they share a `.git`
// and a branch namespace. Falls back to the project directory where git is
// absent or the project is not a repository at all.
function worktreeId(dir) {
  try {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    if (!r.error && r.status === 0) {
      const top = (r.stdout ?? '').trim();
      if (top) return normalizePath(top);
    }
  } catch {
    // No git on PATH is not an error here - the fallback is a real answer.
  }
  return normalizePath(dir);
}

// Every read here is best-effort by design. A missing file is the normal case
// (first session in a fresh project), and a corrupt one must read as "no
// leases" rather than as an exception: a session that cannot parse the file is
// a session that must carry on working, not one that crashes its own hook.
function readLeases(dir) {
  let raw;
  try {
    raw = fs.readFileSync(leasePath(dir), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.leases)) return [];
    return parsed.leases.filter((l) => l && typeof l.sessionId === 'string' && l.sessionId);
  } catch {
    return [];
  }
}

// The freshest evidence that a session is still alive, and which signal gave
// it. Two independent sources, because each one alone has a blind spot:
//
//   renewedAt  - written by this plugin's hooks. PostToolUse only fires on an
//                edit, so a session in a long read-only stretch stops
//                renewing. That is exactly what the other session was doing
//                during the incident: reading, testing, diagnosing.
//   transcript - the harness appends to the session's .jsonl every turn,
//                whatever the session is doing. It advances through reading,
//                thinking and waiting on the user, and stops the moment the
//                session does.
//
// Taking the later of the two means a session has to go quiet on BOTH counts
// before its lease expires, which is the conservative direction: the cost of
// calling a live session dead is a missed warning about a real collision.
function lastSeen(entry) {
  let at = 0;
  let signal = 'unknown';

  const renewed = Date.parse(entry.renewedAt ?? '');
  if (Number.isFinite(renewed)) {
    at = renewed;
    signal = 'hook';
  }

  if (typeof entry.transcript === 'string' && entry.transcript) {
    try {
      const m = fs.statSync(entry.transcript).mtimeMs;
      if (m > at) {
        at = m;
        signal = 'transcript';
      }
    } catch {
      // A transcript that has been moved or cleaned up just means this signal
      // has nothing to say; renewedAt still does.
    }
  }

  return { at, signal };
}

function isLive(entry, now, ttl) {
  const seen = lastSeen(entry);
  if (seen.at === 0) return false;
  // A clock skew that puts a lease in the future is still a sign of life, not
  // a reason to treat it as expired.
  return now - seen.at < ttl;
}

// The one dangerous shape, stated as a predicate rather than spread across two
// hooks: same worktree, same milestone, a DIFFERENT session, still alive.
//
// Each clause is a case that must NOT fire:
//   - same sessionId: a session re-entering its own work (a /clear, a resume,
//     a second SessionStart) is not competing with itself.
//   - different worktree: two checkouts of one repository are independent.
//   - different milestone: two sessions deliberately splitting the queue.
//   - not live: a session that died to a usage limit or a crash left this
//     behind, and holding its milestone hostage is the lockout of constraint 3.
//
// A missing sessionId fails open and returns null. The hooks are also run
// directly - devkit-help invokes session-welcome.js, devkit-eval runs hooks by
// hand - and on that path there is no payload and so no way to tell our own
// lease from a stranger's. Reporting a conflict there would mean telling a solo
// session it is colliding with itself, which is exactly the false alarm
// constraint 2 forbids.
function findConflict({ dir, sessionId, milestone, worktree, now = Date.now(), ttl }) {
  if (!sessionId || !milestone) return null;
  const mine = worktree ?? worktreeId(dir);
  for (const l of readLeases(dir)) {
    if (l.sessionId === sessionId) continue;
    if (l.milestone !== milestone) continue;
    if (l.worktree && l.worktree !== mine) continue;
    if (!isLive(l, now, ttl)) continue;
    return l;
  }
  return null;
}

// The only writer. Whole file through a temp and a rename, which is atomic on
// both POSIX and Windows within a volume, so no reader ever catches a
// half-written list - and a reader that did would take it as "no leases" and
// silently stop detecting anything.
//
// The temp file is cleaned up on failure. Without that, a project whose state
// directory has gone unwritable would collect one orphan per edit, since
// PostToolUse renews on every single one.
function writeLeases(dir, leases) {
  const file = leasePath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ensureGitignoreEntry(dir);
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, leases }, null, 2)}\n`, 'utf8');
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

// Publish this session's presence and drop anyone provably gone.
//
// Leases are a list rather than a single record on purpose: two sessions
// working DIFFERENT milestones in one tree is legitimate, and a single-slot
// file would make each evict the other, so neither would be visible when a
// third session arrived on a milestone one of them held.
//
// Written whole through a temp file and a rename, which is atomic on both
// POSIX and Windows within a volume, so no reader ever sees a half-written
// file. Two sessions renewing at the same instant can still lose one update -
// the loser's entry simply reappears on its next hook, at most one turn or one
// edit later. That failure direction is deliberate: it costs a late warning,
// never a false one, and it needs no lock file to go wrong in its own way.
function renew(dir, entry, { now = Date.now(), ttl } = {}) {
  const nowIso = new Date(now).toISOString();
  try {
    const existing = readLeases(dir);
    const previous = existing.find((l) => l.sessionId === entry.sessionId);
    const kept = existing.filter((l) => l.sessionId !== entry.sessionId && isLive(l, now, ttl));

    kept.push({
      ...entry,
      // Recorded for a human reading this file next to a process list, never
      // used as a liveness test - see the header on why pids are not the key.
      hookParentPid: process.ppid,
      startedAt: (previous && previous.startedAt) || nowIso,
      renewedAt: nowIso,
    });

    return writeLeases(dir, kept);
  } catch {
    // An unwritable state directory is a reason to know less, never a reason
    // to fail an edit, block a stop or crash a greeting. Constraint 2.
    return false;
  }
}

// Remove this session's own lease. Not wired to any hook - the harness has no
// "session ended" event that fires when a session is killed, which is the case
// that matters - but the TTL handles that and this makes the state file
// hand-fixable without editing JSON.
function release(dir, sessionId) {
  try {
    return writeLeases(dir, readLeases(dir).filter((l) => l.sessionId !== sessionId));
  } catch {
    return false;
  }
}

function minutesAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return 'less than a minute ago';
  return m === 1 ? '1 minute ago' : `${m} minutes ago`;
}

// The evidence, not a verdict. Everything here is something a human can check
// against their own screen: a session id they can match to a window, when it
// was last seen and by which signal, and the branch it is on.
function describeConflict(entry, now = Date.now()) {
  const seen = lastSeen(entry);
  const how =
    seen.signal === 'transcript'
      ? 'its transcript was appended to'
      : seen.signal === 'hook'
        ? 'one of its hooks ran'
        : 'it was last recorded';
  return [
    `  session     ${entry.sessionId}`,
    `  milestone   ${entry.milestone}`,
    entry.branch ? `  branch      ${entry.branch}` : null,
    `  last seen   ${minutesAgo(now - seen.at)} (${how})`,
    entry.startedAt ? `  claimed at  ${entry.startedAt}` : null,
  ].filter((l) => l !== null);
}

module.exports = {
  DEFAULT_TTL_MINUTES,
  LEASE_FILE,
  ttlMs,
  leasePath,
  worktreeId,
  readLeases,
  lastSeen,
  isLive,
  findConflict,
  renew,
  release,
  describeConflict,
};
