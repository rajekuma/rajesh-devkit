'use strict';

// Every git call the plugin makes goes through here, with a time limit.
//
// Why. A hook waits on git synchronously, and git can itself wait on something
// else. Found on Windows (Git for Windows 2.43): a system gitconfig set
// core.fsmonitor, and a `git add -A` waited on the file-watcher daemon for 40
// minutes. A hook stuck like that holds up the session it runs in (PRINCIPLES 5).
// On a timeout the answer is null, which every caller already reads as "cannot
// tell" - for a fingerprint, "cannot prove fresh", never a match.
//
// GIT_OPTIONAL_LOCKS=0 because a `git status` killed mid-run could otherwise
// leave the user's index.lock behind, breaking their next git command. None of
// the plugin's reads need that lock.

const { spawnSync } = require('child_process');

const QUICK_MS = 5000; // rev-parse, branch, status, show
const TREE_MS = 30000; // staging a whole working tree into a throwaway index

// Lowers the limits, never raises them: the tests use it to make a hung git
// fail fast instead of waiting 30 seconds.
function limit(ms) {
  const cap = Number(process.env.RAJESH_DEVKIT_GIT_TIMEOUT_MS);
  return Number.isFinite(cap) && cap > 0 ? Math.min(ms, cap) : ms;
}

// Trimmed stdout, or null if git is missing, failed or ran out of time.
function run(dir, args, { env, timeoutMs = QUICK_MS } = {}) {
  try {
    const r = spawnSync('git', args, {
      cwd: dir || undefined,
      encoding: 'utf8',
      timeout: limit(timeoutMs),
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...(env || {}) },
    });
    if (r.error || r.status !== 0) return null;
    return (r.stdout ?? '').trim();
  } catch {
    return null;
  }
}

module.exports = { QUICK_MS, TREE_MS, run };
