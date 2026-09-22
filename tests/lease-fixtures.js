'use strict';

// Helpers for the liveness tests. Kept out of helpers.js because they are the
// only fixtures that have to agree with production code about something -
// worktree identity - rather than just writing files into a temp directory.

const fs = require('fs');
const path = require('path');
const lease = require('../scripts/lib/lease');

const MILESTONE = 'M1 - User login';

// A spec mid-flight: Approved, two of three criteria ticked. The shape the
// resume banner reacts to, and therefore the shape a collision is dangerous
// in - "resume at criterion 3" is precisely the instruction that must not be
// handed to a second session.
const PARTIAL = [
  '# Spec: User login',
  '',
  'Milestone: M1 - Status: Approved',
  '',
  '## Acceptance criteria',
  '',
  '- [x] Rejects a bad password',
  '- [x] Issues a token',
  '- [ ] Expires it',
  '',
].join('\n');

const UX = '# UX: User login\n';

function specs() {
  return { 'user-login.md': PARTIAL, 'user-login.ux.md': UX };
}

const MINUTE = 60 * 1000;

// Writes the lease file by hand, standing in for the other session.
//
// The worktree is taken from the production helper rather than hardcoded: a
// fixture that normalised its own path would pass while a mismatch in the real
// comparison went unnoticed, which is the one thing these tests cannot afford
// to get wrong.
function writeLease(dir, overrides = {}) {
  const entry = {
    sessionId: 'other-session-0001',
    milestone: MILESTONE,
    worktree: lease.worktreeId(dir),
    branch: 'feat/user-login',
    transcript: null,
    startedAt: new Date(Date.now() - 9 * MINUTE).toISOString(),
    renewedAt: new Date().toISOString(),
    ...overrides,
  };
  const file = lease.leasePath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, leases: [entry] }, null, 2), 'utf8');
  return entry;
}

function readLeaseFile(dir) {
  try {
    return JSON.parse(fs.readFileSync(lease.leasePath(dir), 'utf8'));
  } catch {
    return null;
  }
}

// A harness payload with a session identity in it. Every hook gets one for
// real - verified against a live harness on SessionStart, Stop and PostToolUse.
function payload(sessionId, extra = {}) {
  return JSON.stringify({ session_id: sessionId, ...extra });
}

// Stands in for the session's own .jsonl, whose mtime is the signal that keeps
// a lease alive through a long read-only stretch.
function transcriptFile(dir, ageMs = 0) {
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, '{}\n', 'utf8');
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  }
  return file;
}

module.exports = { MILESTONE, MINUTE, PARTIAL, UX, specs, writeLease, readLeaseFile, payload, transcriptFile };
