#!/usr/bin/env node
'use strict';

// PostToolUse hook (matched on Edit|Write): after every edit, re-reads the
// host project's PROGRESS.md, diffs its milestone statuses against the last
// snapshot, and logs a "milestone_shipped" telemetry event for anything that
// just flipped to done. Pairs with continue-loop's "milestone_started" event
// so devkit-stats can report a duration and a cost per milestone.
//
// And, for a session driving the loop, checks that a milestone just marked
// done actually went through the gates this project enabled. Found in real
// use (M35a/M35b): the sensitive-milestone message named only the reviewer,
// so whether quality, security and ship ran depended on the model
// remembering them. A row flipped to done with a gate never recorded is said
// out loud here - exit 2 on PostToolUse shows the model this message; the
// edit itself has already happened, so nothing is blocked or undone.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const gates = require('./lib/gates');
const arm = require('./lib/arm');
const receipt = require('./lib/receipt');

const hookInput = d.readStdinJson();

const dir = d.projectDir();
if (!dir) process.exit(0);

// Defer to a project's own loop skill - and here the reason is functional,
// not tidiness. This script logs the "shipped" half of a pair; continue-loop
// logs the "started" half, and devkit-stats reports a milestone only when it
// can match the two. In a project with its own loop, continue-loop has
// already deferred and no "started" event is ever written, so every "shipped"
// event written here would be permanently unpairable. Exit before writing
// anything.
//
// The same test continue-loop uses, not "does a spec-loop skill exist". This
// hook alone still asked the old question, so in a project that keeps its old
// skill as a fallback but hands the loop over with "loop": "devkit", every
// milestone was started and none ever shipped - devkit-stats had nothing to
// report for any of them.
const config = d.readStageConfig(dir);
if (!d.devkitOwnsLoop(dir, config)) process.exit(0);

const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) process.exit(0);

const current = d.readMilestoneStatuses(progressPath);
const keys = Object.keys(current);
if (keys.length === 0) process.exit(0);

const outDir = d.telemetryDir(dir);
const snapshotPath = path.join(outDir, 'telemetry.snapshot.json');
const telemetryPath = path.join(outDir, 'telemetry.jsonl');

// No snapshot means this is the first time this hook has ever looked at the
// tracker, not that every finished row just shipped. Treating it as the
// latter logged a "shipped" event for every milestone ever finished - none of
// them pairable with a start - so the first run only records the baseline.
let previous = null;
const snapshotText = d.readFileOrNull(snapshotPath);
if (snapshotText !== null) {
  try {
    previous = JSON.parse(snapshotText) ?? {};
  } catch {
    previous = null;
  }
}

const nowUtc = new Date().toISOString();
const justDone = previous
  ? keys.filter((key) => current[key].done && !previous[key])
  : [];

// Best-effort, like every write to this plugin's state: a hook that cannot
// write its telemetry loses a data point, never the user's edit.
try {
  fs.mkdirSync(outDir, { recursive: true });
  d.ensureGitignoreEntry(dir);
  if (justDone.length > 0) {
    const lines = justDone.map((key) =>
      JSON.stringify({ event: 'milestone_shipped', milestone: current[key].display, timestamp: nowUtc })
    );
    fs.appendFileSync(telemetryPath, `${lines.join('\n')}\n`, 'utf8');
  }
  const snapshot = {};
  for (const key of keys) snapshot[key] = current[key].done;
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot), 'utf8');
} catch {
  /* telemetry is a nice-to-have; never fail the edit over it */
}

// The gate check. Only for a session that is driving the loop: a person
// ticking a row by hand in a session doing other work is never nagged
// (PRINCIPLES 4). Presence only, not freshness - marking the row done edits
// PROGRESS.md, which changes the tree every verdict was stamped against, so
// freshness is checked just BEFORE closing out (continue-loop says so), and
// here the question is simply whether each gate ran at all for this milestone.
const sessionId =
  hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
const sessionStages = arm.stagesOf(dir, sessionId);
if (sessionStages) config.stages = sessionStages;
const expected = ['ui-verify', 'review', 'quality', 'security', 'ship'].filter((g) =>
  d.stageEnabled(config, g)
);

// Milestones this session just finished. Gates are checked first, and a
// missing gate is logged, so the record made next - and its receipt - can
// count the warning it caused.
const finishedHere = justDone.filter((key) => arm.isDriving(dir, config, sessionId, current[key]));

const warnings = [];
if (expected.length > 0) {
  let recorded = {};
  try {
    recorded = gates.readGates(dir);
  } catch {
    recorded = {};
  }
  for (const key of finishedHere) {
    const m = current[key];
    const missing = expected.filter((g) => !recorded[g] || recorded[g].milestone !== m.display);
    if (missing.length > 0) {
      warnings.push({ display: m.display, missing });
      d.appendTelemetry(dir, 'gates_missing', m.display, undefined, { gates: missing });
    }
  }
}

// Record each finished milestone into the project's own metrics
// (scripts/milestone-metrics.js): active time, cost, size of the change, and
// what devkit did for it. Here rather than in the close-out instructions
// because a record that depends on the model remembering to make it is the
// M35a/M35b story again - it was never made. Synchronous and bounded: the
// transcript scan takes a few seconds, runs once per finished milestone, and
// any failure just means no record.
if (config.metrics !== false) {
  for (const key of finishedHere) {
    try {
      spawnSync(process.execPath, [path.join(__dirname, 'milestone-metrics.js'), 'record', key], {
        encoding: 'utf8',
        timeout: 45000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
    } catch {
      /* no record this time; the telemetry is still there to record it later */
    }
  }
}

// What the user sees at the moment the milestone is called done - the same
// moment the loop asks whether to commit. Before, the numbers existed only if
// someone thought to run devkit-stats afterwards, and nothing at all said what
// the plugin had done. Read from the record just written, so they are the
// committed figures, and cost no model tokens to produce.
function readRecords() {
  try {
    const rel = config.metricsDir || path.join('docs', 'metrics');
    const file = path.isAbsolute(rel) ? path.join(rel, 'milestones.jsonl') : path.join(dir, rel, 'milestones.jsonl');
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const money = (v) => (v == null ? 'unknown' : `$${v.toFixed(2)}`);
const records = config.metrics !== false && finishedHere.length > 0 ? readRecords() : [];

// A phase finished: the one point where a push - and the CI run, and any
// deployment CI starts - is due. The loop never pushes (only the deliver
// stage may, and only by explicit opt-in), so without this nothing says so
// and finished phases sit on a local branch.
function phaseNote(key) {
  const m = current[key];
  const row = d.findMilestoneByNumber(progressPath, String(key).replace(/^M/, ''));
  if (!row || !row.phase) return null;
  const p = d.phaseProgress(progressPath, row.phase);
  if (!p || p.done < p.total) return null;
  const mine = records.filter((r) => r.phase != null && String(r.phase) === String(row.phase));
  const known = mine.filter((r) => r.costUsd != null);
  const totals =
    mine.length > 0
      ? ` Recorded for this phase: ${mine.length} of ${p.total} milestones, ` +
        `${money(known.reduce((sum, r) => sum + r.costUsd, 0))}${known.length < mine.length ? ' (some costs unknown)' : ''}, ` +
        `${Math.round(mine.reduce((sum, r) => sum + r.activeHours, 0) * 10) / 10} active h.`
      : '';
  const handoff = d.stageEnabled(config, 'deliver')
    ? 'The deliver stage is enabled, so devkit-deliver opens the PR at this boundary.'
    : 'This loop never pushes. Tell the user plainly that the phase is ready to push, so CI runs ' +
      "(and whatever deployment this project's CI starts), give them the push command for the " +
      'current branch, and do not run it yourself.';
  return `Phase ${row.phase} is complete with ${m.display} (all ${p.total} of its milestones done).${totals} ${handoff}`;
}

const receipts = [];
for (const key of finishedHere) {
  const r = records.find((x) => x.milestone === key);
  if (r) receipts.push(receipt.format(r, { enabledGates: expected }));
}
const phaseNotes = finishedHere.map(phaseNote).filter(Boolean);

const shown = [...receipts, ...phaseNotes].join('\n\n');
const report =
  receipts.length + phaseNotes.length > 0
    ? (receipts.length > 0
        ? 'DevKit receipt for the milestone just marked done (from the record written to the ' +
          "project's metrics - the user has been shown it too):\n" +
          receipts.join('\n\n') +
          '\nWhen you report the milestone complete and ask about committing, repeat this receipt ' +
          'verbatim in a code block, rather than leaving the user to ask for devkit-stats.'
        : '') +
      (phaseNotes.length > 0 ? `${receipts.length > 0 ? '\n' : ''}${phaseNotes.join(' ')}` : '')
    : '';

if (warnings.length === 0) {
  if (report) {
    // systemMessage is shown to the user directly, so the receipt does not
    // depend on the model choosing to repeat it; additionalContext gives the
    // model the same text for its summary. Exit 0: nothing is blocked.
    process.stdout.write(
      `${JSON.stringify({
        systemMessage: shown,
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: report },
      })}\n`
    );
  }
  process.exit(0);
}

const recordGate = path.join(__dirname, 'record-gate.js').split(path.sep).join('/');
const text = warnings
  .map(
    (w) =>
      `${w.display} was just marked done, but no verdict is recorded for it from: ` +
      `${w.missing.join(', ')}. This project enables those gates, so the milestone has not ` +
      'been through its full chain - whoever implemented it, the directly-implemented and ' +
      'the delegated route owe the same gates.'
  )
  .join(' ');
process.stderr.write(
  `${text} Before anything else - before committing, and before moving to the next ` +
    'milestone - run each missing gate against the current tree and stamp its verdict ' +
    `(\`node "${recordGate}" <gate> <verdict>\`); if a gate finds something, fix it and ` +
    'treat the milestone as unfinished until the gates pass. If the user deliberately ' +
    'skipped a gate for this milestone, say so in your reply instead - never stamp a ' +
    'verdict for a gate that did not run.' +
    (report ? ` ${report}` : '') +
    '\n'
);
process.exit(2);
