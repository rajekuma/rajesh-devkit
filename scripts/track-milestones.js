#!/usr/bin/env node
'use strict';

// PostToolUse hook (matched on Edit|Write): after every edit, re-reads the
// host project's PROGRESS.md, diffs its milestone statuses against the last
// snapshot, and logs a "milestone_shipped" telemetry event for anything that
// just flipped to done. Pairs with continue-loop's "milestone_started" event
// (same display-name format) so devkit-stats can report a duration per
// milestone. Never blocks anything - always exits 0.

const fs = require('fs');
const path = require('path');
const d = require('./lib/devkit');

d.readStdin(); // drain the harness payload; this hook doesn't need it

const dir = d.projectDir();
if (!dir) process.exit(0);

// Defer to a project's own loop skill - and here the reason is functional,
// not tidiness. This script logs the "shipped" half of a pair; continue-loop
// logs the "started" half, and devkit-stats reports a milestone only when it
// can match the two. In a project with its own loop, continue-loop has
// already deferred and no "started" event is ever written, so every "shipped"
// event written here would be permanently unpairable - it would create a
// .claude/rajesh-devkit/ folder and append a .gitignore line to someone's
// repo, on every Edit, to accumulate data nothing can ever read. Exit before
// writing anything.
if (d.hasOwnLoopSkill(dir)) process.exit(0);

const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) process.exit(0);

const current = d.readMilestoneStatuses(progressPath);
const keys = Object.keys(current);
if (keys.length === 0) process.exit(0);

const outDir = d.telemetryDir(dir);
fs.mkdirSync(outDir, { recursive: true });
d.ensureGitignoreEntry(dir);

const snapshotPath = path.join(outDir, 'telemetry.snapshot.json');
const telemetryPath = path.join(outDir, 'telemetry.jsonl');

let previous = {};
const snapshotText = d.readFileOrNull(snapshotPath);
if (snapshotText !== null) {
  try {
    previous = JSON.parse(snapshotText) ?? {};
  } catch {
    previous = {};
  }
}

const nowUtc = new Date().toISOString();
const shipped = [];
for (const key of keys) {
  const wasDone = Boolean(previous[key]);
  if (current[key].done && !wasDone) {
    shipped.push(
      JSON.stringify({ event: 'milestone_shipped', milestone: current[key].display, timestamp: nowUtc })
    );
  }
}
if (shipped.length > 0) {
  fs.appendFileSync(telemetryPath, `${shipped.join('\n')}\n`, 'utf8');
}

const snapshot = {};
for (const key of keys) snapshot[key] = current[key].done;
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8');

process.exit(0);
